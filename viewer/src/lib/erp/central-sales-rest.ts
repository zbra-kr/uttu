import 'server-only';
import type { CentralRestDiagnostic } from './central-rest-diagnostics';
import { CENTRAL_SQL, CENTRAL_DAILY_SQL, parseCentralScope } from './central-sales-read';
import { CentralReadTimeout, type CentralExecutor, type CentralQuery } from './central-sales-server';

export interface SnowflakeRestBinding {
  origin: string;
  database: string;
  schema: string;
  warehouse: string;
  role: string;
  // Existing trusted server signer, not a key/token from a request parameter.
  getToken(signal: AbortSignal): Promise<string>;
}
export const CENTRAL_REST_SQL = CENTRAL_SQL.replaceAll('%s', '?');
export const CENTRAL_DAILY_REST_SQL = CENTRAL_DAILY_SQL.replaceAll('%s','?');
type Obj = Record<string, unknown>;
function obj(x: unknown): x is Obj { return !!x && typeof x === 'object' && !Array.isArray(x); }
function check(condition: unknown): asserts condition { if (!condition) throw new Error('REST_INVALID'); }
function handle(x: unknown): x is string { return typeof x === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(x); }
function date(x: string) { return `${x.slice(0,4)}-${x.slice(4,6)}-${x.slice(6)}`; }
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  check(response.body && Number(response.headers.get('content-length') ?? 0) <= 262144);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength; check(size <= 262144); chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error('REST_CANCELLED');
  let abort: (() => void) | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => {
    abort = () => reject(new Error('REST_CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
  })]); } finally { if (abort) signal.removeEventListener('abort', abort); }
}
export function createCentralRestExecutor(binding: SnowflakeRestBinding, http: typeof fetch = fetch, onDiagnostic?: (value:CentralRestDiagnostic)=>void): CentralExecutor {
  // Snapshot trusted composition config; never infer account JWT identity from host.
  const { origin, database, schema, warehouse, role, getToken } = binding;
  const url = new URL(origin);
  check(url.protocol === 'https:' && url.origin === origin && !url.username && !url.password &&
    !url.port && /^[a-z0-9.-]+\.snowflakecomputing\.com$/i.test(url.hostname));
  check([database, schema, warehouse, role].every(x => typeof x === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(x)));
  return { async execute(query: CentralQuery): Promise<unknown> {
    const binds = [...query.binds];
    const daily=query.sql===CENTRAL_DAILY_SQL,statement=daily?CENTRAL_DAILY_REST_SQL:CENTRAL_REST_SQL,maxRows=daily?32:201;
    const columns=daily?['BRANDCD','SALEDT','SALES_VAT_EX']:['BRANDCD','STYLECD','SALEDT','SALES_VAT_EX'];
    check((query.sql === CENTRAL_SQL||daily) && binds.length === 3 && query.maxRows === maxRows &&
      query.statementTimeoutSeconds === 10 && query.maxEstimatedScanBytes === 16777216 &&
      typeof binds[1] === 'string' && typeof binds[2] === 'string' && /^\d{8}$/.test(binds[1]) && /^\d{8}$/.test(binds[2]));
    const scope = parseCentralScope({ brand: binds[0], from: date(binds[1]), to: date(binds[2]) }).scope;
    check(scope);
    const controller = new AbortController(); const abort = () => controller.abort();
    let timedOut = false;
    if (query.signal.aborted) throw new Error('CENTRAL_REST_CANCELLED');
    query.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; abort(); }, 10000);
    let token: string | null = null; let activeHandle: string | null = null;
    const diagnostic:CentralRestDiagnostic={code:'FAILED',phase:'SIGNER',httpStatus:null,numRows:null,receivedRows:null,partitionCount:null,completedPartitions:0,partitionRowCountSum:null,partitionCountsMatch:null,responseComplete:false,...(daily?{aggregation:'DAILY_SUMMARY' as const}:{})};
    const report=(code:CentralRestDiagnostic['code'])=>{try{onDiagnostic?.({...diagnostic,code});}catch{/* diagnostics never change read behavior */}};
    const headers = () => ({ Authorization: `Bearer ${token}`, 'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
      'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'UTTU-CentralSales/1.0' });
    const request = async (path: string, init: RequestInit) => {
      const response = await abortable(http(origin + path, { ...init, headers: headers(), signal: controller.signal, redirect: 'error', cache: 'no-store' }), controller.signal);
      diagnostic.httpStatus=response.status;
      if (response.status === 408) {
        timedOut = true; controller.abort(); void response.body?.cancel().catch(() => {});
        throw new CentralReadTimeout();
      }
      if (response.status !== 200 && response.status !== 202) void response.body?.cancel().catch(() => {});
      check(response.status === 200 || response.status === 202);
      const value = await boundedJson(response, controller.signal); check(obj(value));
      if (init.method === 'POST' && handle(value.statementHandle)) activeHandle = value.statementHandle;
      // No resubmission of POST or silent partial results. A slow statement is
      // cancelled; selecting a smaller scope can be done by the existing caller.
      check(response.status === 200 && value.code === '090001' && value.sqlState === '00000');
      return value;
    };
    const post = (statement: string) => request('/api/v2/statements', { method: 'POST', body: JSON.stringify({
      statement, timeout: 10, database, schema, warehouse, role,
      bindings: Object.fromEntries(binds.map((value, i) => [String(i + 1), { type: 'TEXT', value }])),
    }) });
    try {
      token = await abortable(getToken(controller.signal), controller.signal);
      check(typeof token === 'string' && token.length > 0 && token.length <= 16384 && !/[\r\n]/.test(token));
      diagnostic.phase='PREFLIGHT';
      const explain = await post('EXPLAIN USING JSON ' + statement);
      check(obj(explain.resultSetMetaData) && explain.resultSetMetaData.numRows === 1 && explain.resultSetMetaData.format === 'jsonv2' &&
        Array.isArray(explain.resultSetMetaData.partitionInfo) && explain.resultSetMetaData.partitionInfo.length === 1 &&
        obj(explain.resultSetMetaData.partitionInfo[0]) && explain.resultSetMetaData.partitionInfo[0].rowCount === 1 &&
        Array.isArray(explain.data) && explain.data.length === 1 && Array.isArray(explain.data[0]) && explain.data[0].length === 1 && typeof explain.data[0][0] === 'string');
      const plan: unknown = JSON.parse(explain.data[0][0]);
      check(obj(plan) && obj(plan.GlobalStats)); const stats = plan.GlobalStats;
      check(Number.isInteger(stats.bytesAssigned) && Number(stats.bytesAssigned) >= 0 && Number(stats.bytesAssigned) <= query.maxEstimatedScanBytes &&
        Number.isInteger(stats.partitionsAssigned) && Number(stats.partitionsAssigned) >= 0 && Number(stats.partitionsAssigned) <= 32);
      activeHandle = null;
      diagnostic.phase='RESULT';diagnostic.httpStatus=null;
      const first = await post(statement);
      check(obj(first.resultSetMetaData)); const meta = first.resultSetMetaData;
      check(Number.isInteger(meta.numRows) && Number(meta.numRows) >= 0 && Number(meta.numRows) <= maxRows && meta.format === 'jsonv2');
      diagnostic.numRows=Number(meta.numRows);
      check(Array.isArray(meta.rowType) && meta.rowType.length === columns.length && meta.rowType.every(obj));
      const names = meta.rowType.map(c => c.name);
      check(names.join(',') === columns.join(','));
      check(meta.rowType.slice(0,columns.length-1).every(c => c.type === 'text') && ['real','fixed'].includes(String(meta.rowType[columns.length-1].type)));
      check(Array.isArray(meta.partitionInfo) && meta.partitionInfo.length >= 1 && meta.partitionInfo.length <= 4);
      const partitions = meta.partitionInfo;
      diagnostic.partitionCount=partitions.length;
      check(partitions.every(p => obj(p) && Number.isInteger(p.rowCount) && Number(p.rowCount) >= 0 && Number(p.rowCount)<=maxRows));
      const partitionSum=partitions.reduce((sum,p)=>sum+Number(p.rowCount),0);
      diagnostic.partitionRowCountSum=partitionSum<=maxRows?partitionSum:null;
      diagnostic.partitionCountsMatch=partitionSum===meta.numRows;
      check(diagnostic.partitionCountsMatch);
      if(Array.isArray(first.data)&&first.data.length<=maxRows)diagnostic.receivedRows=first.data.length;
      check(Array.isArray(first.data) && first.data.length === partitions[0].rowCount);
      diagnostic.completedPartitions=1;
      const rows: unknown[] = [...first.data];
      for (let index = 1; index < partitions.length; index++) {
        diagnostic.phase='PARTITION';
        check(activeHandle); const expected = activeHandle;
        const part = await request(`/api/v2/statements/${expected}?partition=${index}`, { method: 'GET' });
        if(Array.isArray(part.data)&&rows.length+part.data.length<=maxRows)diagnostic.receivedRows=rows.length+part.data.length;
        check(part.statementHandle === expected && Array.isArray(part.data) && part.data.length === partitions[index].rowCount);
        diagnostic.completedPartitions=index+1;
        rows.push(...part.data);
      }
      check(rows.length === meta.numRows);
      diagnostic.phase='ROW_VALIDATION';
      const keys = new Set<string>();
      const projection = rows.map(row => {
        check(Array.isArray(row) && row.length === columns.length && row[0] === scope.brand);
        const dayIndex=daily?1:2,amountIndex=daily?2:3;
        if(!daily)check(typeof row[1]==='string'&&row[1].trim()&&row[1].length<=160);
        check(typeof row[dayIndex]==='string'&&/^\d{8}$/.test(row[dayIndex]));
        const d=date(row[dayIndex]);check(!parseCentralScope({brand:scope.brand,from:d,to:d}).reason&&d>=scope.from&&d<=scope.to);
        const amount=row[amountIndex];
        check(amount===null||(typeof amount==='number'&&Number.isFinite(amount))||(typeof amount==='string'&&amount.length<=100&&/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(amount)));
        const key=JSON.stringify(row.slice(0,amountIndex));check(!keys.has(key));keys.add(key);
        return daily?{BRANDCD:row[0],SALEDT:row[dayIndex],SALES_VAT_EX:amount}:{BRANDCD:row[0],STYLECD:row[1],SALEDT:row[dayIndex],SALES_VAT_EX:amount};
      });
      activeHandle = null;
      // Every advertised partition and row has been received and validated.
      // The server separately withholds the SQL LIMIT sentinel (201 groups).
      diagnostic.responseComplete=true;report(projection.length>(daily?31:200)?'LIMIT_REACHED':'COMPLETE');
      return { complete: true, rows: projection };
    } catch {
      report(timedOut?'TIMEOUT':controller.signal.aborted?'CANCELLED':'FAILED');
      // Best-effort physical cancellation with its own bounded signal. HTTP
      // abort alone does not prove that Snowflake cancelled the statement.
      if (activeHandle && token) {
        const cancel = new AbortController(); const cancelTimer = setTimeout(() => cancel.abort(), 1000);
        try { const response = await abortable(http(`${origin}/api/v2/statements/${activeHandle}/cancel`, {
          method:'POST', headers:headers(), signal:cancel.signal, redirect:'error', cache:'no-store',
        }), cancel.signal); void response.body?.cancel().catch(() => {}); } catch { /* no raw error */ }
        finally { clearTimeout(cancelTimer); }
      }
      if (timedOut) throw new CentralReadTimeout();
      throw new Error(controller.signal.aborted ? 'CENTRAL_REST_CANCELLED' : 'CENTRAL_REST_FAILED');
    } finally { clearTimeout(timer); query.signal.removeEventListener('abort', abort); token = null; }
  } };
}
