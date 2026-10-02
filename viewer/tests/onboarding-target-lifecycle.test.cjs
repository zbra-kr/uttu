// Execute the real effect with a deterministic DOM/clock model; not browser QA.
const test=require('node:test');const assert=require('node:assert/strict');const load=require('./helpers/load-source.cjs');
const lib=load('src/lib/onboarding/tour.ts');
const HINT='이 화면에서는 버튼이 보이지 않아 설명으로 안내해요. 다음 단계로 계속할 수 있어요.';
function runtime(step=2){
  const keys=['window','document','getComputedStyle','MutationObserver','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','clearTimeout'];
  const previous=Object.fromEntries(keys.map(k=>[k,global[k]]));
  const hooks=[],effects=[],timers=new Map(),frames=new Map();let cursor=0,dirty=true,tree,clock=0,seq=0,mutation,resize,targets=[],iterations=0;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const React={useState(v){const i=cursor++;if(!hooks[i])hooks[i]={value:v};return[hooks[i].value,n=>{const v=typeof n==='function'?n(hooks[i].value):n;if(!Object.is(v,hooks[i].value)){hooks[i].value=v;dirty=true;}}];},useRef(v){const i=cursor++;if(!hooks[i])hooks[i]={current:v};return hooks[i];},useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps)){const old=hooks[i];hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn();});}}};React.useLayoutEffect=React.useEffect;
  const body={style:{overflow:''}};const listeners=()=>{};
  global.window={innerWidth:403,innerHeight:606,visualViewport:{width:403,height:606,offsetTop:0,addEventListener:listeners,removeEventListener:listeners},addEventListener:listeners,removeEventListener:listeners,setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,at:clock+delay});return id;}};
  global.clearTimeout=id=>timers.delete(id);global.requestAnimationFrame=fn=>{const id=++seq;frames.set(id,fn);return id;};global.cancelAnimationFrame=id=>frames.delete(id);
  global.getComputedStyle=el=>({visibility:el.hidden?'hidden':'visible'});
  global.MutationObserver=class{constructor(fn){mutation=fn;}observe(){}disconnect(){}};global.ResizeObserver=class{constructor(fn){resize=fn;}observe(){}disconnect(){}};
  global.document={body,documentElement:{setAttribute(){},removeAttribute(){}},querySelectorAll:()=>targets,activeElement:null};
  const dialogNode={showModal(){},close(){},contains:n=>n?.inside===true};
  let cardStyle={};const cardNode={scrollHeight:398,get clientHeight(){return Math.min(400,cardStyle.maxHeight??400)-2;},getBoundingClientRect(){return{width:371,height:Math.min(400,cardStyle.maxHeight??400)};}};
  const walk=(node,fn)=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(n=>walk(n,fn));return;}fn(node);walk(node.props?.children,fn);};
  const overlay=load(process.env.UTTU_OVERLAY_SOURCE || 'src/components/onboarding/TourOverlay.tsx',{
    react:React,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    'react-dom':{createPortal:node=>node},'@/lib/onboarding/tour':lib,
    '@/components/ui/icons':{IcBookmark:()=>null,IcEdit:()=>null,IcSpark:()=>null},
    './tour.module.css':new Proxy({},{get:(_,key)=>String(key)}),
  }).default;
  function render(){cursor=0;dirty=false;tree=overlay({step,saveWarning:false,onNext(){},onBack(){},onSkip(){}});walk(tree,node=>{if(node.props?.ref){node.props.ref.current=node.type==='dialog'?dialogNode:node.type==='h2'?{focus(){}}:cardNode;if(node.type==='div')cardStyle=node.props.style||{};}});while(effects.length)effects.shift()();}
  function flush(){iterations=0;do{if(++iterations>60)throw new Error('effect loop');if(dirty)render();const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}while(dirty||frames.size);}
  render();flush();
  const text=node=>typeof node==='string'?node:(!node||typeof node!=='object')?'':Array.isArray(node)?node.map(text).join(' '):text(node.props?.children);
  return{setTargets(next){targets=next;mutation?.([{target:body}]);flush();},advance(ms){clock+=ms;let pending;do{pending=[...timers.entries()].filter(([,v])=>v.at<=clock);for(const[id,v]of pending){timers.delete(id);v.fn();}flush();}while(pending.length);},text:()=>text(tree),tree:()=>tree,resize(){resize?.();flush();},dispose(){for(const h of hooks)h?.cleanup?.();for(const[k,v]of Object.entries(previous))v===undefined?delete global[k]:global[k]=v;}};
}
const target=(bounds={left:16,top:300,width:80,height:30})=>({isConnected:true,scrollIntoView(){},getBoundingClientRect:()=>bounds});
test('detached old desktop target does not suppress the mobile missing-target hint',()=>{
  const h=runtime();try{const old=target();h.setTargets([old]);h.advance(100);old.isConnected=false;h.setTargets([]);h.advance(1800);assert.match(h.text(),new RegExp(HINT));}finally{h.dispose();}
});
test('grace period uses current visibility, then clears/reappears when a real target returns/disappears',()=>{
  const h=runtime();try{h.advance(1799);assert.ok(!h.text().includes(HINT));h.advance(1);assert.ok(h.text().includes(HINT));h.setTargets([target()]);assert.ok(!h.text().includes(HINT));h.setTargets([]);assert.ok(h.text().includes(HINT));}finally{h.dispose();}
});
test('an offscreen target with nonzero dimensions is unavailable after grace',()=>{
  const h=runtime();try{h.setTargets([target({left:16,top:900,width:80,height:30})]);h.advance(1800);assert.ok(h.text().includes(HINT));}finally{h.dispose();}
});
test('steps with no target never claim a missing control',()=>{
  const h=runtime(3);try{h.advance(2000);assert.ok(!h.text().includes(HINT));}finally{h.dispose();}
});

test('a capped card keeps its natural height through resize measurements without oscillation',()=>{
  const h=runtime();try{h.setTargets([target()]);const cardStyle=()=>{let found;const walk=n=>{if(!n||typeof n!=='object')return;if(Array.isArray(n))return n.forEach(walk);if(n.type==='div'&&n.props?.ref&&n.props?.style?.maxHeight)found=n.props.style;walk(n.props?.children);};walk(h.tree());return found;};for(let i=0;i<4;i++){h.resize();assert.equal(cardStyle().maxHeight,262);assert.equal(cardStyle().top,16);}}finally{h.dispose();}
});
