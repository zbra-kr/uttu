export const qa:any={counts:{},writes:[],network:[],errors:[]};(window as any).rankingFixture=qa;
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#ddd"/></svg>');
export const rows=Array.from({length:120},(_,i)=>({snapshot_date:'2026-10-04',store_code:'musinsa',musinsa_no:String(100000+i),rank_position:i+1,rank_change:i%4===0?5:0,product_name:'Local sample product '+(i+1),brand_name:'Fixture Brand',company_name:'Fixture Company',category_code:'000',gender_filter:'A',age_filter:'AGE_BAND_ALL',final_price:39000,list_price:49000,discount_rate:20,review_score:4.8,review_count:100+i,is_own:i%2===0,thumbnail_url:image,image_url:image}));
export async function read(name:string,args:any[]){qa.counts[name]=(qa.counts[name]||0)+1;
if(/^(create|update|delete|save|overwrite|mark|add|remove|toggle|run|reset|upload)/.test(name)){qa.writes.push(name);throw Error('Writes disabled: '+name);}
if(name==='fetchLatestRanking')return rows.map(r=>({...r,category_code:args[0]?.categoryCode||r.category_code,gender_filter:args[0]?.genderFilter||r.gender_filter,age_filter:args[0]?.ageFilter||r.age_filter}));
if(name==='fetchRankingDaily'){const request=args[0],date=request.date||'2026-10-04';const current=rows.slice(0,100).map(r=>({...r,snapshot_date:date,category_code:request.categoryCode,gender_filter:request.genderFilter,age_filter:request.ageFilter,products:{is_own:r.is_own,brands:{companies:{corp_name:r.company_name}}}}));return {request,date,previousDate:'2026-10-03',current,previous:current.map((r,i)=>({...r,snapshot_date:'2026-10-03',rank_position:i<95?r.rank_position+5:r.rank_position}))};}
if(name==='fetchBrandOptions')return [{name:'Fixture Brand'},{name:'Second Brand'}];
if(name==='fetchCompanyOptions')return [{corp_name:'Fixture Company'}];
if(name==='fetchUnreadCount'||name==='fetchNoteCountForEntity')return 0;
if(name==='fetchNoteForEntity')return {id:args[0],entity_type:args[1],entity_id:args[2],body:'Local fixture note',tags:[],user_id:'fixture-user',created_at:'2026-10-04T00:00:00Z',updated_at:'2026-10-04T00:00:00Z'};
if(name==='fetchMyProfile')return {id:'fixture-user',display_name:'Fixture Viewer',role:'viewer'};
if(name==='fetchShellStats')return {anomalyCount:0,reviewTotal:120,reviewAvgRating:4.8,reviewLowCount:0,snapNew7d:0,magazineNew7d:0,promoActiveCount:0};
if(name==='isBookmarked')return false;
if(name==='normImgUrl')return image;
return [];}
window.addEventListener('error',e=>qa.errors.push(e.message));
window.fetch=async(input:any,init:any)=>{const u=new URL(input instanceof Request?input.url:String(input),location.href);qa.network.push(u.pathname);if(u.origin===location.origin&&u.pathname.startsWith('/api/'))return new Response(JSON.stringify({connected:false,remaining:0,models:[]}),{headers:{'content-type':'application/json'}});throw Error('Network disabled in fixture: '+u.origin+u.pathname);};
