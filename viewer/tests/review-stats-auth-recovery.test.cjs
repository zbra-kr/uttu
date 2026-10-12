const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),Renderer=require('react-test-renderer'),load=require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function fixture({sync=false,event}={}){
 const identities=[],reads=[],listeners=new Set();const f={identities,reads,listeners,current:null};
 const client={auth:{getUser(){const d=deferred();identities.push(d);if(sync&&identities.length===1)throw Error('offline');return d.promise},onAuthStateChange(fn){listeners.add(fn);if(event!==undefined)fn('INITIAL_SESSION',event?{user:{id:event}}:null);return {data:{subscription:{unsubscribe(){listeners.delete(fn)}}}}}}};
 const {useReviewStats}=load('src/hooks/useReviewStats.ts',{'@/lib/supabase/client':{supabaseBrowser:()=>client},'@/lib/queries':{fetchReviewStats(days,signal){const d=deferred();reads.push({...d,days,signal});return d.promise}}});
 f.Harness=({days=30})=>{f.current=useReviewStats(days);return null};f.auth=id=>{for(const fn of listeners)fn(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null)};return f;
}
const stats=total=>({total,avgRating:4,lowCount:0,ratingDist:[0,total,0,0,0],imageCount:0});
for(const failure of ['sdk','rejection','sync'])test(`statistics auth ${failure} recovers once after repeated retry`,async()=>{
 const f=fixture({sync:failure==='sync'});let root;try{
 await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness))});
 await React.act(async()=>{if(failure==='sdk')f.identities[0].resolve({data:{user:null},error:Error('offline')});if(failure==='rejection')f.identities[0].reject(Error('offline'))});
 const state=f.current.state;assert.equal(f.reads.length,0);
 await React.act(async()=>{f.current.retry();f.current.retry();f.current.retry()});
 assert.deepEqual({state,calls:f.identities.length},{state:'autherror',calls:2});assert.equal(f.current.stats,null);
 await React.act(async()=>f.identities[1].resolve({data:{user:{id:'a'}},error:null}));assert.equal(f.reads.length,1);
 await React.act(async()=>f.reads[0].resolve(stats(123)));assert.equal(f.current.stats.total,123);
 }finally{if(root)await React.act(async()=>root.unmount())}
});
for(const event of ['a',null])test(`statistics synchronous identity ${event} is authoritative`,async()=>{const f=fixture({event});let root;try{await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness))});assert.equal(f.identities.length,0);assert.equal(f.reads.length,event?1:0);assert.equal(f.current.state,event?'loading':'signedout')}finally{if(root)await React.act(async()=>root.unmount())}});
for(const mode of ['null','event'])test(`statistics genuine signout ${mode} blocks late identity and all reads`,async()=>{const f=fixture();let root;try{
 await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness))});
 if(mode==='null')await React.act(async()=>f.identities[0].resolve({data:{user:null},error:null}));else{await React.act(async()=>f.identities[0].reject(Error('offline')));await React.act(async()=>f.current.retry());await React.act(async()=>{f.auth(null);f.identities[1].resolve({data:{user:{id:'old'}},error:null})})}
 assert.equal(f.current.state,'signedout');const calls=f.identities.length;await React.act(async()=>f.current.retry());assert.equal(f.identities.length,calls);assert.equal(f.reads.length,0);
 }finally{if(root)await React.act(async()=>root.unmount())}});
test('statistics recovery event, account changes, retry, period and unmount discard stale values',async()=>{const f=fixture();let root;try{
 await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness))});await React.act(async()=>f.identities[0].reject(Error('offline')));await React.act(async()=>f.current.retry());
 await React.act(async()=>{f.auth('a');f.identities[1].resolve({data:{user:{id:'stale'}},error:null})});assert.equal(f.reads.length,1);
 await React.act(async()=>{f.auth('b');f.reads[0].resolve(stats(666))});assert.equal(f.reads[0].signal.aborted,true);assert.equal(f.current.stats,null);
 await React.act(async()=>f.reads[1].resolve(stats(222)));assert.equal(f.current.stats.total,222);
 await React.act(async()=>{f.current.retry();f.current.retry()});assert.equal(f.current.stats,null);assert.equal(f.reads.length,3);
 await React.act(async()=>{root.update(React.createElement(f.Harness,{days:7}));});await React.act(async()=>f.reads[2].resolve(stats(777)));assert.equal(f.current.stats,null);
 await React.act(async()=>{f.auth('c');f.reads[3].reject(Error('late'))});assert.equal(f.current.stats,null);
 await React.act(async()=>f.reads[4].resolve(stats(333)));assert.equal(f.current.stats.total,333);
 await React.act(async()=>f.auth(null));assert.equal(f.current.stats,null);await React.act(async()=>f.auth('d'));await React.act(async()=>root.unmount());root=null;
 await React.act(async()=>f.reads[5].resolve(stats(999)));assert.equal(f.reads[5].signal.aborted,true);assert.equal(f.listeners.size,0);
 }finally{if(root)await React.act(async()=>root.unmount())}});
test('statistics repeated auth failure remains retryable; late auth rejection cannot replace current account',async()=>{const f=fixture();let root;try{
 await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness))});await React.act(async()=>f.identities[0].reject(Error('first')));
 await React.act(async()=>f.current.retry());await React.act(async()=>f.identities[1].resolve({data:{user:null},error:Error('again')}));assert.equal(f.current.state,'autherror');
 await React.act(async()=>{f.current.retry();f.current.retry()});assert.equal(f.identities.length,3);
 await React.act(async()=>{f.auth('b');f.identities[2].reject(Error('stale failure'))});assert.equal(f.current.state,'loading');assert.equal(f.reads.length,1);
 await React.act(async()=>f.reads[0].resolve(stats(12)));assert.equal(f.current.state,'ready');assert.equal(f.current.stats.total,12);
 }finally{if(root)await React.act(async()=>root.unmount())}});
test('statistics unmount during auth recovery ignores late identity and removes subscription',async()=>{const f=fixture();let root;
 await React.act(async()=>{root=Renderer.create(React.createElement(f.Harness))});await React.act(async()=>f.identities[0].reject(Error('offline')));await React.act(async()=>f.current.retry());
 await React.act(async()=>root.unmount());await React.act(async()=>f.identities[1].resolve({data:{user:{id:'late'}},error:null}));assert.equal(f.reads.length,0);assert.equal(f.listeners.size,0);
});
