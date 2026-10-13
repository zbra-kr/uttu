import 'server-only';
import { requesterIdsFromEnvironment } from './requester-allowlist';
import { createPrivateKey } from 'node:crypto';
import { createSnowflakeJwtSupplier } from './snowflake-jwt';
import type { RequesterRestBinding } from './requester-sales-rest';

// Reads only dependencies already supplied by the owning Node server. Does not
// load key files, register secrets, infer requester identity, or open connections.
export function bindingFromExistingEnvironment(env: Readonly<Record<string,string|undefined>>): RequesterRestBinding|null {
  try {
    const ids=requesterIdsFromEnvironment(env),origin=env.SNOWFLAKE_REST_ORIGIN;
    const account=env.SNOWFLAKE_ACCOUNT,user=env.SNOWFLAKE_USER,pem=env.SNOWFLAKE_PRIVATE_KEY;
    const database=env.SNOWFLAKE_DATABASE,schema=env.SNOWFLAKE_SCHEMA,warehouse=env.SNOWFLAKE_WAREHOUSE,role=env.SNOWFLAKE_ROLE;
    if(!ids||!origin||!account||!user||!pem)return null;
    if(![database,schema,warehouse,role].every(v=>typeof v==='string'&&/^[A-Za-z0-9_]{1,128}$/.test(v)))return null;
    const url=new URL(origin);
    if(url.origin!==origin||url.protocol!=='https:'||url.username||url.password||url.port||!/^[a-z0-9.-]+\.snowflakecomputing\.com$/i.test(url.hostname))return null;
    // Existing EIS PEM convention; no PRIVATE_KEY_PATH or Mac-host fallback.
    const passphrase=env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE;
    const key=createPrivateKey({key:pem.replace(/\\n/g,'\n'),format:'pem',...(passphrase?{passphrase}:{})});
    const getToken=createSnowflakeJwtSupplier({privateKey:key,accountIdentifier:account,userName:user});
    return {expectedRequesterId:ids[0],...(env.UTTU_ERP_REQUESTER_IDS!==undefined?{expectedRequesterIds:ids}:{}),rest:{origin,database:database!,schema:schema!,warehouse:warehouse!,role:role!,getToken}};
  }catch{return null;} // No crypto/config value or error escapes into UI/logs.
}
