const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react'),JSX=require('react/jsx-runtime');
function fixture(server=false){const compiled={};const files={Shell:'components/shell/ShellClient.tsx',Ai:'components/shell/AiPanel.tsx',Mobile:'components/shell/MobileShell.tsx',viewport:'hooks/useViewport.ts',format:'lib/format.ts'};for(const [key,file]of Object.entries(files))compiled[key]=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;compiled.OldShell=compiled.Shell;return createFixture(React,JSX,compiled,server);}
function createFixture(React,JSX,compiled,isServer=false){
 const cache={},storage=new Map();let route=isServer?null:'/',date=isServer?'2026-10-03T14:59:00Z':'2026-10-03T15:01:00Z',media=false;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[date]))}static now(){return new Date(date).getTime()}}
 const no=()=>null;const inert=new Proxy({__esModule:true,default:no},{get:(t,k)=>k in t?t[k]:no});
 const browser=isServer?undefined:{matchMedia:()=>({matches:media,addEventListener(){},removeEventListener(){}}),addEventListener(){},removeEventListener(){}};
 const api={fetchAllowedModels:async()=>({models:[],current:null}),fetchUnreadCount:async()=>0,updatePreferredModel:async()=>{},fetchShellStats:async()=>({anomalyCount:0,reviewTotal:0,reviewAvgRating:0,reviewLowCount:0,snapNew7d:0,magazineNew7d:0,promoActiveCount:0})};
 const paths={'./AiPanel':'Ai','./MobileShell':'Mobile','@/hooks/useViewport':'viewport','@/lib/format':'format'};
 function load(key){if(cache[key])return cache[key];const exports={};cache[key]=exports;
 const scope={exports,require(id){if(id==='react')return React;if(id==='react/jsx-runtime')return JSX;if(paths[id])return load(paths[id]);if(id==='next/navigation')return{usePathname:()=>route,useRouter:()=>({push(){},back(){}})};if(id==='next/link')return{__esModule:true,default:({children,...p})=>React.createElement('a',p,children)};if(id==='@/components/onboarding/OnboardingProvider')return{useOnboarding:()=>({active:false,step:0})};if(id==='@/lib/queries'||id==='@/lib/queries-me')return api;if(id==='@/lib/supabase/client')return{supabaseBrowser:()=>({auth:{getUser:async()=>({data:{user:null}})}})};return inert;},window:browser,document:isServer?undefined:document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},Date:Clock,crypto:{randomUUID:()=> 'inert-fixture-session'},fetch:async()=>({ok:true,json:async()=>({messages:[],sessions:[]})}),setInterval:()=>0,clearInterval(){},setTimeout,clearTimeout,AbortController,console,CustomEvent:globalThis.CustomEvent,process:{env:{}}};
 new Function(...Object.keys(scope),compiled[key])(...Object.values(scope));return exports;}
 return{Shell:load('Shell').default,OldShell:load('OldShell').default,setRoute:v=>route=v,setDate:v=>date=v,setMobile:v=>media=v,setOpen:v=>storage.set('uttu-aip',v?'open':'closed')};
}
module.exports={fixture};
