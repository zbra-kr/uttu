const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const load=require('./helpers/load-source.cjs');
const Link=({href,children,...props})=>React.createElement('a',{href,...props},children);
const View=load('src/components/ranking/RankingDailyInsights.tsx',{
 'next/link':{__esModule:true,default:Link},
 '@/lib/queries':{CATEGORY_MAP:{'000':'전체'},AGE_MAP:{AGE_BAND_ALL:'전체'}},
 '@/lib/queries-ranking-daily':{fetchRankingDaily:()=>{throw Error('render must not read data');}},
 './RankingDailyProvider':{useRankingDailySession:()=>null},
}).default;
const request={categoryCode:'000',genderFilter:'A',ageFilter:'AGE_BAND_ALL'};
const date='2026-10-04',previousDate='2026-10-03';
const scope={version:1,kind:'ranking',period:'today',fromDate:'',toDate:'',selectedCategory:'000',gender:'A',age:'AGE_BAND_ALL',price:[0,50],companies:[],brands:[],ownOnly:false,moverOnly:false,sort:'rank',sortDir:'asc',page:1};
const row=(id,rank,day,rate)=>({store_code:'musinsa',snapshot_date:day,category_code:'000',gender_filter:'A',age_filter:'AGE_BAND_ALL',musinsa_no:String(id),rank_position:rank,product_name:'Item '+id,brand_name:'Brand',final_price:10000,discount_rate:rate,products:{is_own:true,brands:{companies:{corp_name:'Company'}}}});
test('sales prompts render only for the validated top five and retain exact source links',()=>{
 const current=[10.004,10,9,null,30,25].map((rate,i)=>row(i+1,i+1,date,rate));
 const previous=current.map((_,i)=>row(i+1,i+11,previousDate,10));
 const data={request,date,previousDate,current,previous};
 const html=renderToStaticMarkup(React.createElement(View,{scope,compact:false,load:{key:'test',loading:false,error:false,data}}));
 for(const direction of ['increased','unchanged','decreased','unknown'])assert.match(html,new RegExp(`data-discount-direction="${direction}"`));
 assert.match(html,/원자료의 작은 차이가 표시 반올림으로 같게 보일 수 있습니다/);
 assert.equal((html.match(/data-discount-direction=/g)||[]).length,5);
 assert.match(html,/href="\/ranking\?context=ranking-v1/);
 assert.match(html,/notes=open/);
 assert.match(html,/2026-10-04/);
 assert.match(html,/2026-10-03/);
 assert.doesNotMatch(html,/Item 6/);
});
