import 'server-only';
import { createPrivateKey } from 'node:crypto';
import { bindingFromExistingEnvironment } from './existing-node-binding';

export type BindingDiagnosticCode = 'PASS'|'MISSING'|'FORMAT_INVALID'|'PASSPHRASE_REQUIRED'|'KEY_IMPORT_FAILED'|'KEY_DECRYPTION_OR_IMPORT_FAILED'|'KEY_TYPE_OR_SIZE_INVALID'|'BINDING_REJECTED';
export interface BindingDiagnostic {readonly field:string;readonly code:BindingDiagnosticCode}
const IDENTIFIER=/^[A-Za-z0-9_]{1,128}$/;

// Server-owned inputs only. Return fixed names/codes, never values, lengths,
// fingerprints, error objects or tokens. No logger, file access, signing or HTTP.
export function diagnoseExistingBindingEnvironment(env:Readonly<Record<string,string|undefined>>):readonly BindingDiagnostic[]{
  const checks:BindingDiagnostic[]=[];
  const add=(field:string,code:BindingDiagnosticCode)=>checks.push({field,code});
  const check=(field:string,valid:(v:string)=>boolean)=>{
    const v=env[field];add(field,!v?'MISSING':valid(v)?'PASS':'FORMAT_INVALID');
  };
  check('UTTU_ERP_REQUESTER_ID',v=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v));
  check('SNOWFLAKE_ACCOUNT',v=>v.length<=128&&/^[A-Za-z0-9_]+(?:[-.][A-Za-z0-9_]+)*$/.test(v)&&! /\.snowflakecomputing\.com$/i.test(v));
  check('SNOWFLAKE_USER',v=>/^[A-Za-z_][A-Za-z0-9_$]{0,127}$/.test(v));
  for(const field of ['SNOWFLAKE_DATABASE','SNOWFLAKE_SCHEMA','SNOWFLAKE_WAREHOUSE','SNOWFLAKE_ROLE'])check(field,v=>IDENTIFIER.test(v));
  check('SNOWFLAKE_REST_ORIGIN',v=>{
    try{const u=new URL(v);return u.origin===v&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^[a-z0-9.-]+\.snowflakecomputing\.com$/i.test(u.hostname);}catch{return false;}
  });
  const pem=env.SNOWFLAKE_PRIVATE_KEY,passphrase=env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE;
  if(!pem)add('SNOWFLAKE_PRIVATE_KEY','MISSING');
  else{
    const encrypted=pem.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')||pem.includes('Proc-Type: 4,ENCRYPTED');
    if(encrypted&&!passphrase)add('SNOWFLAKE_PRIVATE_KEY_PASSPHRASE','PASSPHRASE_REQUIRED');
    else{
      if(encrypted)add('SNOWFLAKE_PRIVATE_KEY_PASSPHRASE','PASS');
      try{
        const key=createPrivateKey({key:pem.replace(/\\n/g,'\n'),format:'pem',...(passphrase?{passphrase}:{})});
        add('SNOWFLAKE_PRIVATE_KEY',key.type==='private'&&key.asymmetricKeyType==='rsa'&&typeof key.asymmetricKeyDetails?.modulusLength==='number'&&key.asymmetricKeyDetails.modulusLength>=2048?'PASS':'KEY_TYPE_OR_SIZE_INVALID');
      }catch{add('SNOWFLAKE_PRIVATE_KEY',encrypted?'KEY_DECRYPTION_OR_IMPORT_FAILED':'KEY_IMPORT_FAILED');}
    }
  }
  if(checks.every(c=>c.code==='PASS')){
    try{if(!bindingFromExistingEnvironment(env))add('SERVER_BINDING','BINDING_REJECTED');}catch{add('SERVER_BINDING','BINDING_REJECTED');}
  }
  return checks;
}
