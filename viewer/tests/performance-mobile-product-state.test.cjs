const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
// Reuse the actual-component/actual-reader fixture without registering its tests.
const fixturePath=path.join(__dirname,'performance-mobile-product.test.cjs');
const source=fs.readFileSync(fixturePath,'utf8');
const marker="const test=require('node:test')";
assert.ok(source.includes(marker));
let fixtureSource=source.slice(0,source.indexOf(marker));
const reactMarker="'react':{...React,useState";
assert.ok(fixtureSource.includes(reactMarker));
// Hold B's passive effect for one virtual tick to observe the committed UI
// before that effect can clear A's state. The actual effect runs unchanged.
fixtureSource=fixtureSource.replace(reactMarker,"'react':{...React,useEffect(effect,deps){React.useEffect(()=>{let cleanup;if(opts.holdBEffect&&no==='456'){queue.push({at:now+1,id:seq++,run:()=>{cleanup=effect()}})}else cleanup=effect();return()=>cleanup?.()},deps)},useState");
const fixture=new Module(fixturePath,module);fixture.filename=fixturePath;fixture.paths=Module._nodeModulePaths(__dirname);
fixture._compile(fixtureSource+'\nmodule.exports={scenario};',fixturePath);
const {scenario}=fixture.exports;
for(const[name,options]of [
 ['own to non-own',{nonOwnB:true}],
 ['B reviews reject',{fail:'fetchReviews',failBOnly:true}],
 ['B body rejects',{fail:'fetchBodyStats',failBOnly:true}],
 ['B succeeds',{}],
])test('MobileProduct clears loaded A state and its open review sheet: '+name,async()=>{
 const r=await scenario(name,{...options,openAt:180,navigateAt:200,holdBEffect:true});
 const loadedA=r.events.find(e=>e.kind==='render'&&e.at===180);
 assert.equal(loadedA.reviewA,true);assert.equal(loadedA.bodyA,true);assert.equal(loadedA.sheetA,true);
 const navigationFrame=r.events.find(e=>e.kind==='render'&&e.at===200);
 assert.equal(navigationFrame.loading,true);assert.equal(navigationFrame.product123,false);
 const afterNavigation=r.events.filter(e=>e.kind==='render'&&e.at>=200&&!e.unmounted);
 for(const frame of afterNavigation){assert.equal(frame.reviewA,false);assert.equal(frame.bodyA,false);assert.equal(frame.sheetA,false)}
 const readyB=afterNavigation.filter(e=>!e.loading);assert.ok(readyB.length);
 for(const frame of readyB)assert.equal(frame.product456,true);
 const final=readyB.at(-1);
 if(options.fail){assert.equal(final.reviewB,false);assert.equal(final.bodyB,false)}
 else {assert.equal(final.reviewB,true);assert.equal(final.bodyB,!options.nonOwnB)}
 assert.equal(r.events.filter(e=>e.kind==='sheet-props'&&e.at>=200).length,0);
});
