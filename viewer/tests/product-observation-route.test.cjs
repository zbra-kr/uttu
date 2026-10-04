const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),Renderer=require('react-test-renderer');
const load=require('./helpers/load-source.cjs');
const {productObservationHref}=load('src/lib/product-observation-context.ts');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const inert=new Proxy({__esModule:true,default:()=>null},{get:(target,key)=>target[key]??(()=>null)});
const context={product:'123',store:'musinsa',date:'2026-10-05',category:'000',gender:'A',age:'AGE_BAND_ALL'};

function fixture(){
 const saved={window:global.window,document:global.document,CustomEvent:global.CustomEvent};
 const listeners=new Set(),calls={detail:[],observation:[]};let query='no=1e3&obs=ranking-v1',mobile=false;
 global.window={matchMedia:()=>({matches:mobile,addEventListener(_event,fn){listeners.add(fn)},removeEventListener(_event,fn){listeners.delete(fn)}}),dispatchEvent(){},addEventListener(){},removeEventListener(){}};
 global.document={addEventListener(){},removeEventListener(){}};
 global.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options?.detail;}};
 const Link=({href,children,...props})=>React.createElement('a',{href,...props},children);
 const detail=no=>{calls.detail.push(no);return Promise.resolve({id:'product-123',musinsa_no:String(no),name:'Current product detail',brand_name:'Fixture Brand',final_price:49000,discount_rate:10,rank_position:20,review_count:0,category_code:'000',is_own:false,labels:[],colors:[],sizes:[],item_seasons:[],ranking_best_records:[]});};
 const mocks={
  'next/navigation':{usePathname:()=>'/product',useSearchParams:()=>new URLSearchParams(query),useRouter:()=>({push(){},replace(){},back(){}})},
  'next/link':{__esModule:true,default:Link},
  '@/lib/queries':{CATEGORY_MAP:{'000':'All'},AGE_MAP:{AGE_BAND_ALL:'All'},fetchShellStats:async()=>null,
   fetchProductDetail:detail,fetchProductPriceHistory:async()=>[],fetchProductRankHistory:async()=>[],fetchProductCategoryRanks:async()=>({rows:[],snapshot_date:'2026-10-05'}),fetchReviews:async()=>({rows:[],total:0}),fetchBodyStats:async()=>null,searchProducts:async()=>[]},
  '@/lib/queries-me':{fetchNoteCountForEntity:async()=>0,logView:async()=>{}},
  '@/lib/queries-product-observation':{fetchProductObservation:async(value)=>{calls.observation.push(value);return{status:'missing'};}},
  '@/lib/supabase/client':{supabaseBrowser:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getUser:async()=>({data:{user:{id:'account-a'}}})}})},
  '@/components/me/NoteDrawer':{__esModule:true,default:()=>null,useSourceNoteDrawer:()=>({noteDrawerOpen:false,setNoteDrawerOpen(){}}),SourceNoteFallback:()=>null},
  '@/components/me/BookmarkToggle':inert,
  '@/components/ui/icons':inert,
  '@/components/mobile/MobileEmptyState':inert,
  '@/components/mobile/ReviewDetailSheet':inert,
  'recharts':inert,
  '@/components/onboarding/OnboardingProvider':{useOnboarding:()=>({active:false,step:0})},
 };
 for(const name of ['./Sidebar','./Topbar','./AiPanel','./CmdK','./MobileShell'])mocks[name]=inert;
 mocks['./MobileShell']={__esModule:true,default:props=>React.createElement('mobile-shell',null,props.children)};
 const Shell=load('src/components/shell/ShellClient.tsx',mocks).default;
 const Product=load('src/app/(app)/product/page.tsx',mocks).default;
 const App=()=>React.createElement(Shell,null,React.createElement(Product));
 return{App,calls,setQuery(value){query=value},resize(value){mobile=value;for(const fn of [...listeners])fn({matches:value})},restore(){for(const key of ['window','document','CustomEvent']){if(saved[key]===undefined)delete global[key];else global[key]=saved[key];}}};
}

test('real Product route in Shell blocks legacy readers for malformed observed IDs on desktop and mobile',async()=>{
 const f=fixture();let root;
 try{
  for(const mobile of [false,true]){
   await React.act(async()=>{if(root)f.resize(mobile);else root=Renderer.create(React.createElement(f.App));});
   for(const bad of ['no=1e3&obs=ranking-v1','no=123junk&obs=ranking-v1','no=123&obs=ranking-v1',
    new URL(productObservationHref(context),'https://local.invalid').search.slice(1)+'&no=123']){
    f.setQuery(bad);await React.act(async()=>root.update(React.createElement(f.App)));
    assert.equal(root.root.findAllByProps({role:'alert'}).length,1);
    assert.equal(f.calls.detail.length,0,bad);
    assert.equal(f.calls.observation.length,0,bad);
   }
  }
  f.setQuery('no=123');await React.act(async()=>root.update(React.createElement(f.App)));
  assert.ok(f.calls.detail.length>0,'plain legacy URL still loads current product');
  const before=f.calls.observation.length;
  f.setQuery(new URL(productObservationHref(context),'https://local.invalid').search.slice(1));
  await React.act(async()=>root.update(React.createElement(f.App)));
  assert.equal(f.calls.observation.length,before+1,'valid observed URL reads exact observation');
 }finally{if(root)await React.act(async()=>root.unmount());f.restore();}
});
