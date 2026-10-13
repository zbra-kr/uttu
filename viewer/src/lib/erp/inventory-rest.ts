import 'server-only';
import { abortable,boundedJson,type SnowflakeRestBinding } from './central-sales-rest';
import { INVENTORY_BASE_COLUMNS,INVENTORY_COLUMNS,normalizeInventory,blockedInventoryProjection,type InventoryScope,type InventorySource,type InventoryProjection } from './inventory-read';
import { INVENTORY_SQL } from './inventory-sql';
export interface InventoryProvider { read(scope:InventoryScope,signal:AbortSignal):Promise<Record<InventorySource,InventoryProjection>> }
type Obj=Record<string,unknown>;
function obj(x:unknown):x is Obj{return !!x&&typeof x==='object'&&!Array.isArray(x);}
function check(ok:unknown):asserts ok{if(!ok)throw new Error('INVENTORY_REST_INVALID');}
const handle=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9-]{1,100}$/.test(x);
export function createInventoryRestProvider(binding:SnowflakeRestBinding,http:typeof fetch=fetch):InventoryProvider{
  const {origin,database,schema,warehouse,role,getToken}=binding;const url=new URL(origin);
  check(url.protocol==='https:'&&url.origin===origin&&!url.username&&!url.password&&!url.port&&/^[a-z0-9.-]+\.snowflakecomputing\.com$/i.test(url.hostname));
  check([database,schema,warehouse,role].every(x=>typeof x==='string'&&/^[A-Za-z0-9_]{1,128}$/.test(x)));
  return {async read(input,signal){
    // Fixed source SQL and11TEXT bindings; no names/SQL/host from request input.
    const scope={brand:input.brand,styles:[...input.styles]};
    check(['CO','LE','WA','CK','LK'].includes(scope.brand)&&scope.styles.length>0&&scope.styles.length<=10&&new Set(scope.styles).size===scope.styles.length&&scope.styles.every(s=>/^[A-Za-z0-9_-]{1,80}$/.test(s)));
    const binds=[scope.brand,...scope.styles,...Array(10-scope.styles.length).fill(scope.styles[0])];
    const controller=new AbortController();const abort=()=>controller.abort();let timedOut=false;
    if(signal.aborted)return {shop:blockedInventoryProjection('error','READ_TIMEOUT'),warehouse:blockedInventoryProjection('error','READ_TIMEOUT')};
    signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{timedOut=true;abort();},10000);
    let token:string|null=null,active:string|null=null;
    const headers=()=>({Authorization:`Bearer ${token}`,'X-Snowflake-Authorization-Token-Type':'KEYPAIR_JWT','Content-Type':'application/json',Accept:'application/json','User-Agent':'UTTU-InventoryRead/1.0'});
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
    const result={} as Record<InventorySource,InventoryProjection>;
    try{
      token=await abortable(getToken(controller.signal),controller.signal);check(typeof token==='string'&&token.length>0&&token.length<=16384&&!/[\r\n]/.test(token));
      for(const source of ['shop','warehouse'] as const){
        try{
          if(controller.signal.aborted)throw new Error();
          const plan=await post('EXPLAIN USING JSON '+INVENTORY_SQL[source]);
          check(obj(plan.resultSetMetaData)&&plan.resultSetMetaData.numRows===1&&plan.resultSetMetaData.format==='jsonv2'&&Array.isArray(plan.resultSetMetaData.partitionInfo)&&plan.resultSetMetaData.partitionInfo.length===1&&obj(plan.resultSetMetaData.partitionInfo[0])&&plan.resultSetMetaData.partitionInfo[0].rowCount===1&&Array.isArray(plan.data)&&plan.data.length===1&&Array.isArray(plan.data[0])&&plan.data[0].length===1&&typeof plan.data[0][0]==='string');
          const parsed:unknown=JSON.parse(plan.data[0][0]);check(obj(parsed)&&obj(parsed.GlobalStats));const stats=parsed.GlobalStats;
          check(Number.isInteger(stats.bytesAssigned)&&Number(stats.bytesAssigned)>=0&&Number(stats.bytesAssigned)<=16777216&&Number.isInteger(stats.partitionsAssigned)&&Number(stats.partitionsAssigned)>=0&&Number(stats.partitionsAssigned)<=32);
          active=null;const first=await post(INVENTORY_SQL[source]);check(obj(first.resultSetMetaData));const meta=first.resultSetMetaData;
          const columns=[...INVENTORY_BASE_COLUMNS,...INVENTORY_COLUMNS[source]];
          check(meta.format==='jsonv2'&&Number.isInteger(meta.numRows)&&Number(meta.numRows)>=1&&Number(meta.numRows)<=201&&Array.isArray(meta.rowType)&&meta.rowType.length===columns.length&&meta.rowType.every((c,i)=>obj(c)&&c.name===columns[i]&&typeof c.type==='string'));
          check(Array.isArray(meta.partitionInfo)&&meta.partitionInfo.length>0&&meta.partitionInfo.length<=4&&meta.partitionInfo.every(p=>obj(p)&&Number.isInteger(p.rowCount)&&Number(p.rowCount)>=0)&&meta.partitionInfo.reduce((sum,p)=>sum+Number(p.rowCount),0)===meta.numRows&&Array.isArray(first.data)&&first.data.length===meta.partitionInfo[0].rowCount);
          const rows:unknown[]=[...first.data];
          for(let i=1;i<meta.partitionInfo.length;i++){check(active);const expected=active;const part=await request(`/api/v2/statements/${expected}?partition=${i}`,{method:'GET'});check(part.statementHandle===expected&&Array.isArray(part.data)&&part.data.length===meta.partitionInfo[i].rowCount);rows.push(...part.data);}
          check(rows.length===meta.numRows&&rows.every(r=>Array.isArray(r)&&r.length===columns.length));
          const types=Object.fromEntries(meta.rowType.map(c=>[c.name,c.type]));
          result[source]=normalizeInventory(source,scope,{complete:rows.length<=200,types,rows:rows.map(r=>Object.fromEntries(columns.map((c,i)=>[c,(r as unknown[])[i]])))});
          active=null;
        }catch{await cancel();result[source]=blockedInventoryProjection('error',timedOut||controller.signal.aborted?'READ_TIMEOUT':'READ_FAILED');}
      }
    }catch{for(const source of ['shop','warehouse'] as const)result[source]=blockedInventoryProjection('error',timedOut||controller.signal.aborted?'READ_TIMEOUT':'READ_FAILED');}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);token=null;}
    return result;
  }};
}
