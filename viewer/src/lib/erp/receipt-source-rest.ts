import 'server-only';
import { abortable,boundedJson,type SnowflakeRestBinding } from './central-sales-rest';
import { RECEIPT_COLUMNS,normalizeReceiptSource,receiptState,type ReceiptScope,type ReceiptSourceState } from './receipt-source-read';
import { planReceiptSource } from './receipt-source-plan';

export interface ReceiptSourceProvider { read(scope:ReceiptScope,signal:AbortSignal):Promise<ReceiptSourceState> }
type Obj=Record<string,unknown>;
function obj(x:unknown):x is Obj{return !!x&&typeof x==='object'&&!Array.isArray(x);}
function check(ok:unknown):asserts ok{if(!ok)throw new Error('RECEIPT_REST_INVALID');}
const handle=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9-]{1,100}$/.test(x);
export function createReceiptSourceProvider(binding:SnowflakeRestBinding,http:typeof fetch=fetch):ReceiptSourceProvider{
  const {origin,database,schema,warehouse,role,getToken}=binding;const url=new URL(origin);
  check(url.protocol==='https:'&&url.origin===origin&&!url.username&&!url.password&&!url.port&&/^[a-z0-9.-]+\.snowflakecomputing\.com$/i.test(url.hostname));
  check([database,schema,warehouse,role].every(x=>typeof x==='string'&&/^[A-Za-z0-9_]{1,128}$/.test(x)));
  return {async read(input,signal){
    // Fixed receipt SQL and13TEXT bindings; no names/SQL/host from request input.
    const scope={brand:input.brand,styles:[...input.styles],from:input.from,to:input.to};
    check(['CO','LE','WA','CK','LK'].includes(scope.brand)&&scope.styles.length>0&&scope.styles.length<=10&&new Set(scope.styles).size===scope.styles.length&&scope.styles.every(s=>/^[A-Za-z0-9_-]{1,80}$/.test(s)));
    const plan=planReceiptSource({...scope,styles:scope.styles.join(',')});check(plan);const binds=plan.receipts.binds;
    const controller=new AbortController();const abort=()=>controller.abort();let timedOut=false;
    if(signal.aborted)return receiptState('error','READ_TIMEOUT',scope);
    signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{timedOut=true;abort();},10000);
    let token:string|null=null,active:string|null=null;
    const headers=()=>({Authorization:`Bearer ${token}`,'X-Snowflake-Authorization-Token-Type':'KEYPAIR_JWT','Content-Type':'application/json',Accept:'application/json','User-Agent':'UTTU-ReceiptSourceRead/1.0'});
    const request=async(path:string,init:RequestInit)=>{
      const response=await abortable(http(origin+path,{...init,headers:headers(),signal:controller.signal,redirect:'error',cache:'no-store'}),controller.signal);
      if(response.status===408){timedOut=true;abort();void response.body?.cancel().catch(()=>{});throw new Error();}
      if(response.status!==200&&response.status!==202)void response.body?.cancel().catch(()=>{});
      check(response.status===200||response.status===202);const body=await boundedJson(response,controller.signal);check(obj(body));
      if(init.method==='POST'&&handle(body.statementHandle))active=body.statementHandle;
      check(response.status===200&&body.code==='090001'&&body.sqlState==='00000');return body;
    };
    const post=(statement:string)=>request('/api/v2/statements',{method:'POST',body:JSON.stringify({statement,timeout:10,database,schema,warehouse,role,bindings:Object.fromEntries(binds.map((value,i)=>[String(i+1),{type:'TEXT',value}]))})});
    const cancel=async()=>{if(!active||!token)return;const c=new AbortController(),t=setTimeout(()=>c.abort(),1000);
      try{const r=await abortable(http(`${origin}/api/v2/statements/${active}/cancel`,{method:'POST',headers:headers(),signal:c.signal,redirect:'error',cache:'no-store'}),c.signal);void r.body?.cancel().catch(()=>{});}catch{}finally{clearTimeout(t);active=null;}
    };
    let result:ReceiptSourceState=receiptState('error','READ_FAILED',scope);
    try{
      token=await abortable(getToken(controller.signal),controller.signal);check(typeof token==='string'&&token.length>0&&token.length<=16384&&!/[\r\n]/.test(token));
      {
        try{
          if(controller.signal.aborted)throw new Error();
          const explain=await post('EXPLAIN USING JSON '+plan.receipts.sql);
          check(obj(explain.resultSetMetaData)&&explain.resultSetMetaData.numRows===1&&explain.resultSetMetaData.format==='jsonv2'&&Array.isArray(explain.resultSetMetaData.partitionInfo)&&explain.resultSetMetaData.partitionInfo.length===1&&obj(explain.resultSetMetaData.partitionInfo[0])&&explain.resultSetMetaData.partitionInfo[0].rowCount===1&&Array.isArray(explain.data)&&explain.data.length===1&&Array.isArray(explain.data[0])&&explain.data[0].length===1&&typeof explain.data[0][0]==='string');
          const parsed:unknown=JSON.parse(explain.data[0][0]);check(obj(parsed)&&obj(parsed.GlobalStats));const stats=parsed.GlobalStats;
          check(Number.isInteger(stats.bytesAssigned)&&Number(stats.bytesAssigned)>=0&&Number(stats.bytesAssigned)<=16777216&&Number.isInteger(stats.partitionsAssigned)&&Number(stats.partitionsAssigned)>=0&&Number(stats.partitionsAssigned)<=32);
          active=null;const first=await post(plan.receipts.sql);check(obj(first.resultSetMetaData));const meta=first.resultSetMetaData;
          const columns=[...RECEIPT_COLUMNS];
          check(meta.format==='jsonv2'&&Number.isInteger(meta.numRows)&&Number(meta.numRows)>=1&&Number(meta.numRows)<=201&&Array.isArray(meta.rowType)&&meta.rowType.length===columns.length&&meta.rowType.every((c,i)=>obj(c)&&c.name===columns[i]&&typeof c.type==='string'));
          check(Array.isArray(meta.partitionInfo)&&meta.partitionInfo.length>0&&meta.partitionInfo.length<=4&&meta.partitionInfo.every(p=>obj(p)&&Number.isInteger(p.rowCount)&&Number(p.rowCount)>=0)&&meta.partitionInfo.reduce((sum,p)=>sum+Number(p.rowCount),0)===meta.numRows&&Array.isArray(first.data)&&first.data.length===meta.partitionInfo[0].rowCount);
          const rows:unknown[]=[...first.data];
          for(let i=1;i<meta.partitionInfo.length;i++){check(active);const expected=active;const part=await request(`/api/v2/statements/${expected}?partition=${i}`,{method:'GET'});check(part.statementHandle===expected&&Array.isArray(part.data)&&part.data.length===meta.partitionInfo[i].rowCount);rows.push(...part.data);}
          check(rows.length===meta.numRows&&rows.every(r=>Array.isArray(r)&&r.length===columns.length));
          const types=Object.fromEntries(meta.rowType.map(c=>[c.name,c.type]));
          result=normalizeReceiptSource(scope,{complete:rows.length<=200,types,rows:rows.map(r=>Object.fromEntries(columns.map((c,i)=>[c,(r as unknown[])[i]])))});
          active=null;
        }catch{await cancel();result=receiptState('error',timedOut||controller.signal.aborted?'READ_TIMEOUT':'READ_FAILED',scope);}
      }
    }catch{result=receiptState('error',timedOut||controller.signal.aborted?'READ_TIMEOUT':'READ_FAILED',scope);}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);token=null;}
    return result;
  }};
}
