const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
const { positionCallout } = load('src/lib/onboarding/tour.ts');
const overlap = (p, card, r) => Math.max(0, Math.min(p.top + Math.min(card.height, p.maxHeight), r.top + r.height) - Math.max(p.top, r.top));

test('approximate live 125% mobile fixture chooses near-fit above, not clamped below', () => {
  // Screenshot-derived CSS approximations, not claimed DOM measurements.
  const viewport={width:403,height:606},card={width:371,height:280},rect={left:16,top:310,width:371,height:48};
  const oldMaxTop=viewport.height-card.height-16;
  const oldAbove=rect.top-card.height-16;
  assert.equal(oldAbove,14);
  assert.equal(Math.min(oldMaxTop,rect.top+rect.height+16),310);
  const p=positionCallout(rect,viewport,card);
  assert.equal(p.top,16);assert.equal(p.anchored,true);assert.equal(overlap(p,card,rect),0);
});
for (const deficit of [0.01,0.5,1,2,8,15.99]) test(`above gap short by ${deficit}px still keeps target uncovered`, () => {
  const card={width:368,height:310};const rect={left:16,top:342-deficit,width:368,height:44};
  const p=positionCallout(rect,{width:400,height:660},card);
  assert.equal(p.top,16);assert.equal(p.anchored,true);assert.equal(overlap(p,card,rect),0);
});
test('when neither full-height placement fits, cap to the larger clear band and scroll',()=>{
  const card={width:371,height:460},rect={left:16,top:260,width:371,height:48};
  const p=positionCallout(rect,{width:403,height:606},card);
  assert.deepEqual(p,{left:16,top:324,maxHeight:266,anchored:true});assert.equal(overlap(p,card,rect),0);
  assert.deepEqual(positionCallout(rect,{width:403,height:606},card),p,'natural height keeps repeated measurements stable');
});
test('prefer clear space above when below has less room',()=>{
  const card={width:371,height:460},rect={left:16,top:340,width:371,height:48};
  const p=positionCallout(rect,{width:403,height:606},card);
  assert.equal(p.top,16);assert.equal(p.maxHeight,308);assert.equal(p.anchored,true);assert.equal(overlap(p,card,rect),0);
});
test('full-viewport target uses an honest unanchored fallback instead of covered spotlight',()=>{
  const p=positionCallout({left:4,top:20,width:395,height:566},{width:403,height:606},{width:371,height:400});
  assert.equal(p.anchored,false);assert.equal(p.top,103);assert.equal(p.maxHeight,574);
});
test('tiny viewport and out-of-frame target keep a bounded scrollable fallback',()=>{
  for(const rect of [null,{left:0,top:600,width:200,height:40},{left:0,top:60,width:320,height:40}]){
    const p=positionCallout(rect,{width:320,height:180},{width:380,height:400});
    assert.equal(p.anchored,false);assert.equal(p.maxHeight,148);assert.equal(p.top,16);assert.equal(p.left,16);
  }
});
test('vertical visual viewport offset is applied once when positioning around target',()=>{
  const offsetTop=120;const target={left:16,top:430,width:371,height:48};const card={width:371,height:280};
  const p=positionCallout({...target,top:target.top-offsetTop},{width:403,height:606},card);
  const positioned={...p,top:p.top+offsetTop};assert.equal(positioned.top,136);assert.equal(overlap(positioned,card,target),0);
});
test('anchored placements never overlap target over a range of mobile heights and target bands',()=>{
  for(const viewportHeight of [320,568,606,667,844]) for(const naturalHeight of [220,280,460,900]) for(const top of [20,100,viewportHeight/2,viewportHeight-80]){
    const viewport={width:403,height:viewportHeight},card={width:371,height:naturalHeight},rect={left:16,top,width:371,height:48};
    const p=positionCallout(rect,viewport,card);
    assert.ok(p.top>=16);assert.ok(p.top+Math.min(naturalHeight,p.maxHeight)<=viewportHeight-16+0.001);
    if(p.anchored)assert.equal(overlap(p,card,rect),0,JSON.stringify({viewport,card,rect,p}));
  }
});
