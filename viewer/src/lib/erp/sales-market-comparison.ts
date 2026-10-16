import { centralDisplayTotal,centralAmountDisplay } from './central-sales-display';
import { validCSDate } from '../cs-daily-review-check';
export interface ComparedProduct {brand:string;style:string;productId:string;mapping:{status:'confirmed'|'uncertain';evidence:string;version:string};sales:{date:string;amount:number|null}[];salesComplete:boolean;market:{productId:string;from:string;to:string;startRank:number|null;endRank:number|null;scope:string;complete:boolean};salesFetchedAt:string;marketFetchedAt:string}
export function compareSalesMarket(input:readonly ComparedProduct[],to:string,now:number){
 if(!validCSDate(to)||!Number.isFinite(now))return {rows:[],excluded:input.map(p=>({style:p.style,reason:'PERIOD_INVALID'}))};
 const end=Date.parse(to+'T00:00:00Z'),days=Array.from({length:14},(_,i)=>new Date(end-(13-i)*86400000).toISOString().slice(0,10));
 const rows:{brand:string;style:string;productId:string;previous:number;current:number;changePct:number|null;rankChange:number;signal:string;action:string;from:string;to:string;marketFrom:string;marketTo:string;salesFetchedAt:string;marketFetchedAt:string}[]=[],excluded:{style:string;reason:string}[]=[];
 for(const p of input){
 const reject=(reason:string)=>excluded.push({style:p.style,reason});
 if(!['CO','LE','WA','CK','LK'].includes(p.brand)||!p.style||!p.productId||p.mapping.status!=='confirmed'||!p.mapping.evidence.trim()||!p.mapping.version.trim()){reject('MAPPING_UNVERIFIED');continue;}
 if(input.filter(x=>x.brand===p.brand&&x.style===p.style).length!==1||input.filter(x=>x.productId===p.productId).length!==1){reject('MAPPING_AMBIGUOUS');continue;}
 const ages=[p.salesFetchedAt,p.marketFetchedAt].map(t=>now-Date.parse(t));
 // Initial daily-source freshness policy: 48h grace, not a certified upstream SLA.
 if(ages.some(a=>!Number.isFinite(a)||a<0||a>48*3600000)){reject('STALE_RECOMMENDATION_HELD');continue;}
 if(!p.salesComplete||p.sales.length!==14||new Set(p.sales.map(r=>r.date)).size!==14||p.sales.some(r=>!days.includes(r.date)||r.amount===null||!Number.isFinite(r.amount))){reject('SALES_COVERAGE_OR_NULL');continue;}
 if(!p.market.complete||p.market.productId!==p.productId||p.market.from!==days[6]||p.market.to!==to||!p.market.scope.trim()||![p.market.startRank,p.market.endRank].every(n=>Number.isSafeInteger(n)&&Number(n)>0)){reject('MARKET_SCOPE_OR_COVERAGE');continue;}
 const sum=(rows:typeof p.sales)=>centralDisplayTotal(rows.map(r=>({amount:centralAmountDisplay(r.amount)}))).approximateValue;
 const previous=sum(p.sales.filter(r=>r.date<=days[6])),current=sum(p.sales.filter(r=>r.date>days[6]));
 if(previous===null||current===null){reject('AMOUNT_OVERFLOW');continue;}
 if(!Number.isFinite(previous)||!Number.isFinite(current)){reject('AMOUNT_OVERFLOW');continue;}
 const rankChange=p.market.startRank!-p.market.endRank!,flag=current<previous&&rankChange>0;
 rows.push({brand:p.brand,style:p.style,productId:p.productId,previous,current,changePct:previous>0?(current-previous)/previous*100:null,rankChange,signal:flag?'시장 순위 상승·내부 매출 하락 동시 관측':'내부·시장 방향 확인',action:flag?'가격·리뷰·채널 상세를 확인하세요. 원인 확정 아님.':'동일 조건 추이를 확인하세요.',from:days[0],to,marketFrom:p.market.from,marketTo:p.market.to,salesFetchedAt:p.salesFetchedAt,marketFetchedAt:p.marketFetchedAt});
 }
 return {rows:rows.sort((a,b)=>Number(b.rankChange>0&&b.current<b.previous)-Number(a.rankChange>0&&a.current<a.previous)),excluded};
}
