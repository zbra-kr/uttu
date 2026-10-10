const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),Renderer=require('react-test-renderer');
const load=require('./helpers/load-source.cjs');
const {parseProductHistoryReceipt}=load('src/lib/product-history-window.ts');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const DAY=86400000,at=d=>Date.parse(d+'T00:00:00Z')/DAY,date=n=>new Date(n*DAY).toISOString().slice(0,10);
const monday=n=>n-(new Date(n*DAY).getUTCDay()+6)%7;
function receipt(mode,points,horizonStart='2026-07-06',horizonEnd='2026-10-06'){
 return {version:1,mode,threshold:500,eligibleRows:mode==='weekly'?501:points.length,scope:'product-wide-best',store:'musinsa',horizonStart,horizonEnd,latestDate:points.at(-1)?.[0]??null,
 points:points.map(([d,rank])=>({date:d,rank,category:'000',price:1000,discount_rate:10,weekStart:date(monday(at(d))),weekEnd:date(monday(at(d))+6),observedDays:mode==='weekly'?2:1,currentWeek:monday(at(d))===monday(at(horizonEnd))}))};
}
const weekly=()=>{const points=Array.from({length:14},(_,i)=>[date(at('2026-07-12')+7*i),i<7?100:10]);points[13][0]='2026-10-06';return receipt('weekly',points);};
const sparse=()=>receipt('daily',Array.from({length:14},(_,i)=>[date(at('2026-09-10')+2*i),i<7?100:10]));
const daily=()=>receipt('daily',Array.from({length:14},(_,i)=>[date(at('2026-09-23')+i),i<7?100:10]));
async function scenario(mobile,run){
 const saved={window:global.window,fetch:global.fetch,document:global.document};
 global.window={matchMedia:()=>({matches:mobile,addEventListener(){},removeEventListener(){}}),dispatchEvent(){}};global.document={activeElement:null};global.fetch=()=>{throw Error('live network forbidden');};
 let query='no=123',source=weekly(),waitB;const calls=[];
 const hidden={__esModule:true,default:()=>null};
 const detail={id:'p123',musinsa_no:123,name:'Fixture product',brand_name:'Brand',is_own:false,final_price:1000,list_price:1000,review_count:0,rating:null,ranking_best_records:[],item_seasons:[],labels:[],colors:[],sizes:[]};
 const Component=load(process.env.HISTORY_INSIGHTS_BASELINE ? (mobile?'src/app/(app)/product/.kpi-baseline-mobile.tsx':'src/app/(app)/product/.kpi-baseline-page.tsx') : (mobile?'src/app/(app)/product/MobileProductDetailView.tsx':'src/app/(app)/product/page.tsx'),{
 '@/lib/queries':{CATEGORY_MAP:{},AGE_MAP:{},fetchProductDetail:async n=>({...detail,id:'p'+n,musinsa_no:Number(n)}),fetchProductHistories:async n=>{calls.push(n);if(waitB&&n==='456')return await waitB;return parseProductHistoryReceipt(source);},fetchProductCategoryRanks:async()=>({rows:[],snapshot_date:''}),fetchReviews:async()=>({rows:[],total:0})},
 '@/lib/supabase/client':{supabaseBrowser:()=>({auth:{getUser:async()=>({data:{user:{id:'fixture'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})},
 '@/lib/queries-me':{fetchNoteCountForEntity:async()=>0,logView:async()=>{}},'@/lib/observation-review-context':{useObservationReviewState:()=>null},
 'next/navigation':{useSearchParams:()=>new URLSearchParams(query),useRouter:()=>({push(){}})},'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
 '@/components/product/ProductObservationPanel':hidden,'@/components/me/BookmarkToggle':hidden,'@/components/mobile/ReviewDetailSheet':hidden,
 '@/components/me/NoteDrawer':{...hidden,SourceNoteFallback:()=>null,useSourceNoteDrawer:()=>({noteDrawerOpen:false,setNoteDrawerOpen(){}})},
 recharts:Object.fromEntries(['LineChart','Line','XAxis','YAxis','Tooltip','ResponsiveContainer','ReferenceDot'].map(n=>[n,()=>null])),
 }).default;
 let root;
 const text=node=>!node?'':typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):text(node.children);
 const mount=async()=>{await React.act(async()=>{root=Renderer.create(React.createElement(Component));});};
 const render=async()=>{await React.act(async()=>root.update(React.createElement(Component)));};
 const instanceText=node=>node.children.map(child=>typeof child==='string'?child:instanceText(child)).join('');
 const card=label=>{const node=root.root.findAll(n=>n.type==='div'&&(n.props.className==='kpi'||n.props.style?.textAlign==='center')).find(n=>instanceText(n).includes(label));return node?instanceText(node):'';};
 try {await run({setSource:v=>{source=v;},mount,render,calls,card,text:()=>text(root.toJSON()),navigate:async value=>{query=value;await render();},deferB:()=>{let resolve;waitB=new Promise(r=>resolve=r);return resolve;},retry:async()=>{await React.act(async()=>root.root.findAllByType('button').find(b=>b.children.join('')==='이력 다시 시도').props.onClick());}});}finally{if(root)await React.act(async()=>root.unmount());for(const k of ['window','fetch','document']){if(saved[k]===undefined)delete global[k];else global[k]=saved[k];}}
}
for(const mobile of [false,true]){
 for(const initial of ['weekly','sparse']) test(`${mobile?'mobile':'desktop'} valid weekly and sparse daily receipts reproduce calendar KPI boundaries (${initial})`,()=>scenario(mobile,async s=>{
  if(initial==='sparse')s.setSource(sparse());
  await s.mount();
  if(initial==='weekly'){assert.match(s.card('종료 주 대표값 비교'),/보합/,s.card('7일 추세'));assert.match(s.text(),/12개 인접 주 대표값 비교/);assert.match(s.text(),/2026-09-28 ~ 2026-10-04 \/ 2026-09-21 ~ 2026-09-27/);}
  else{assert.match(s.card('최근 7일 평균 비교'),/—/,s.card('7일 추세'));assert.match(s.text(),/관측 4\/7일 · 이전 3\/7일 · 비교 표본 부족/);}
  assert.doesNotMatch(s.text(),/7일 추세|13일 관측|↑ 90/);
  s.setSource(sparse());await s.navigate('no=124');assert.match(s.card('최근 7일 평균 비교'),/—/);assert.match(s.text(),/관측 4\/7일 · 이전 3\/7일 · 비교 표본 부족/);assert.doesNotMatch(s.text(),/↑ 90/);assert.match(s.text(),/0개 연속 관측일 비교/);
  s.setSource(daily());await s.navigate('no=125');assert.match(s.text(),/↑ 90/);assert.match(s.text(),/관측 7\/7일 · 이전 7\/7일/);
  const before=s.calls.length;await s.navigate('no=125&obs=ranking-v1&store=musinsa&date=2026-10-06&category=003&gender=F&age=AGE_BAND_20');assert.equal(s.calls.length,before);assert.match(s.text(),/↑ 90/);assert.match(s.text(),/선택한 랭킹 관측의 추이가 아닙니다/);
  const clipped=daily();clipped.horizonStart='2026-09-28';clipped.points=clipped.points.filter(p=>p.date>=clipped.horizonStart);clipped.eligibleRows=clipped.points.length;
  s.setSource(clipped);await s.navigate('no=126');assert.match(s.card('최근 7일 평균 비교'),/—/);assert.match(s.text(),/관측 7\/7일 · 이전 2\/7일/);
  const resolve=s.deferB();await s.navigate('no=456');assert.doesNotMatch(s.text(),/↑ 90|최근 7일 평균 비교/);assert.match(s.text(),/이력을 불러오는 중/);
  await React.act(async()=>resolve(parseProductHistoryReceipt(weekly())));assert.match(s.text(),/종료 주 대표값 비교/);assert.doesNotMatch(s.text(),/↑ 90/);
 }));
 test(`${mobile?'mobile':'desktop'} reversed, future and short receipts fail safely then retry clears old mode`,()=>scenario(mobile,async s=>{
  const reversed=weekly();reversed.points.reverse();s.setSource(reversed);await s.mount();assert.match(s.text(),/이력을 불러오지 못했습니다/);assert.doesNotMatch(s.text(),/종료 주 대표값 비교/);
  const future=daily();future.points.at(-1).date='2026-10-07';future.latestDate='2026-10-07';s.setSource(future);await s.retry();assert.match(s.text(),/이력을 불러오지 못했습니다/);
  s.setSource(receipt('daily',[['2026-10-05',20],['2026-10-06',10]]));await s.retry();assert.match(s.text(),/안정성은 3개 이상 필요/);assert.match(s.text(),/비교 표본 부족/);assert.match(s.text(),/1개 연속 관측일 비교/);
 }));
}
