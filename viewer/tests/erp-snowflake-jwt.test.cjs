const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const load=require('./helpers/load-source.cjs'),M=load('src/lib/erp/snowflake-jwt.ts');
// Memory-only synthetic keys. Never serialize private material or use real env.
const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const inputs=()=>({privateKey:rsa.privateKey,accountIdentifier:'synthetic-org_SYN_ACCOUNT',userName:'syn_user'});
const signal=()=>new AbortController().signal;
const decode=token=>{const parts=token.split('.');assert.equal(parts.length,3);return {parts,header:JSON.parse(Buffer.from(parts[0],'base64url')),payload:JSON.parse(Buffer.from(parts[1],'base64url'))};};
test('memory-only RSA signature verifies; RS256 issuer fingerprint/subject and short lifetime match EIS',async()=>{
 const getToken=M.createSnowflakeJwtSupplier(inputs(),()=>1234567890123);const token=await getToken(signal());const {parts,header,payload}=decode(token);
 assert.deepEqual(header,{alg:'RS256',typ:'JWT'});assert.deepEqual(Object.keys(payload).sort(),['exp','iat','iss','sub']);
 const fp='SHA256:'+crypto.createHash('sha256').update(rsa.publicKey.export({type:'spki',format:'der'})).digest('base64');
 assert.equal(payload.sub,'SYNTHETIC-ORG_SYN_ACCOUNT.SYN_USER');assert.equal(payload.iss,payload.sub+'.'+fp);assert.equal(payload.iat,1234567890);assert.equal(payload.exp-payload.iat,59);
 assert.equal(crypto.verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key:rsa.publicKey,padding:crypto.constants.RSA_PKCS1_PADDING},Buffer.from(parts[2],'base64url')),true);
 assert.equal(crypto.verify('sha256',Buffer.from(parts[0]+'.'+parts[1]+'tampered'),rsa.publicKey,Buffer.from(parts[2],'base64url')),false);
});
test('claims use supplied authentication identity; no host-derived normalization or mutation after factory creation',async()=>{
 const input={...inputs(),accountIdentifier:'syn123.region-cloud.aws'};let clock=1000;const getToken=M.createSnowflakeJwtSupplier(input,()=>clock);
 input.accountIdentifier='ATTACKER';input.userName='ATTACKER';input.privateKey=null;
 const first=decode(await getToken(signal())).payload;assert.equal(first.sub,'SYN123.REGION-CLOUD.AWS.SYN_USER');clock=2000;
 const second=decode(await getToken(signal())).payload;assert.equal(second.iat,2);assert.equal(second.exp,61);assert.notEqual(first.iat,second.iat);
});
test('private RSA only: public/secret/EC/Ed25519/RSA-PSS/short RSA and key strings rejected',()=>{
 const keys=[rsa.publicKey,crypto.createSecretKey(Buffer.from('synthetic-only')),crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey,crypto.generateKeyPairSync('ed25519').privateKey,crypto.generateKeyPairSync('rsa-pss',{modulusLength:2048}).privateKey,crypto.generateKeyPairSync('rsa',{modulusLength:1024}).privateKey,'PRIVATE_SENTINEL',null,{}];
 for(const privateKey of keys)assert.throws(()=>M.createSnowflakeJwtSupplier({...inputs(),privateKey}),e=>e.message==='SNOWFLAKE_JWT_INPUT_INVALID');
});
test('invalid account/user strings never enter claims and raw input/getter errors are sanitized',()=>{
 for(const accountIdentifier of ['',null,'https://host','account.snowflakecomputing.com','acct..region',' acct','acct\nprivate','acct.','a'.repeat(129)])assert.throws(()=>M.createSnowflakeJwtSupplier({...inputs(),accountIdentifier}),/SNOWFLAKE_JWT_INPUT_INVALID/);
 for(const userName of ['',null,'user.name','user@example',' user','user\nprivate','USER;SQL','a'.repeat(129)])assert.throws(()=>M.createSnowflakeJwtSupplier({...inputs(),userName}),/SNOWFLAKE_JWT_INPUT_INVALID/);
 assert.throws(()=>M.createSnowflakeJwtSupplier({get privateKey(){throw new Error('PRIVATE_SENTINEL');}}),e=>e.message==='SNOWFLAKE_JWT_INPUT_INVALID');
});
test('abort before signing and during supplied clock prevents token delivery',async()=>{
 const c=new AbortController();c.abort();let clocks=0;const getToken=M.createSnowflakeJwtSupplier(inputs(),()=>{clocks++;return 1000;});
 await assert.rejects(getToken(c.signal),/SNOWFLAKE_JWT_CANCELLED/);assert.equal(clocks,0);
 const d=new AbortController();const during=M.createSnowflakeJwtSupplier(inputs(),()=>{d.abort();return 1000;});await assert.rejects(during(d.signal),/SNOWFLAKE_JWT_CANCELLED/);
 await assert.rejects(getToken(null),/SNOWFLAKE_JWT_SIGNAL_INVALID/);
});
test('invalid clock and thrown dependency failures expose fixed reason only',async()=>{
 for(const ms of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,0.5])await assert.rejects(M.createSnowflakeJwtSupplier(inputs(),()=>ms)(signal()),/SNOWFLAKE_JWT_CLOCK_INVALID/);
 await assert.rejects(M.createSnowflakeJwtSupplier(inputs(),()=>{throw new Error('PRIVATE_SENTINEL');})(signal()),e=>e.message==='SNOWFLAKE_JWT_SIGN_FAILED');
 const hostile=new Error();let reads=0;Object.defineProperty(hostile,'message',{get(){reads++;throw new Error('PRIVATE_ACCESSOR_SENTINEL');}});
 await assert.rejects(M.createSnowflakeJwtSupplier(inputs(),()=>{throw hostile;})(signal()),e=>e.message==='SNOWFLAKE_JWT_SIGN_FAILED');assert.equal(reads,0);
});
test('factory has no key loading/env/network/cache; real runtime composition stays unconfigured',()=>{
 const source=fs.readFileSync('src/lib/erp/snowflake-jwt.ts','utf8');assert.doesNotMatch(source,/process\.env|readFile|createPrivateKey|fetch\(|https?:\/\/|generateKeyPair|console\./);
 const C=load('src/lib/erp/central-sales-composition.ts');assert.equal(C.configuredCentralRequesterBinding(),null);
 const composition=fs.readFileSync('src/lib/erp/central-sales-composition.ts','utf8');assert.doesNotMatch(composition,/snowflake-jwt|createSnowflakeJwtSupplier/);
});
