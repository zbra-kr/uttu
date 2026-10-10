const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
const { productHistoryInsights: insights } = load('src/lib/product-history-insights.ts');
const DAY=86400000, at=d=>Date.parse(d+'T00:00:00Z')/DAY, date=n=>new Date(n*DAY).toISOString().slice(0,10);
function history(mode, points, start='2026-07-06', end='2026-10-06') {
 const coverage={mode,horizonStart:start,horizonEnd:end,rowCount:points.length,capped:false};
 const rank=points.map(p=>({date:p[0],rank:p[1],category:'000'}));
 const price=points.map(p=>({date:p[0],price:1000,discount_rate:p[2]??10}));
 rank.coverage=price.coverage=coverage;return {rank,price};
}
const calculate=h=>insights(h.rank,h.price);
test('weekly 14 representatives cannot be treated as two seven-day means',()=>{
 const points=Array.from({length:14},(_,i)=>[date(at('2026-07-12')+7*i),i<7?100:10]);points[13][0]='2026-10-06';
 const h=history('weekly',points),r=calculate(h);assert.equal(r.velocity,0);assert.equal(r.trendLabel,'종료 주 대표값 비교');assert.equal(r.discountCount,12);
 assert.match(r.discountNote,/12개 인접 주 대표값/);assert.doesNotMatch(r.discountNote,/일 관측/);
 assert.match(r.trendNote,/2026-09-28 ~ 2026-10-04 \/ 2026-09-21 ~ 2026-09-27/);assert.match(r.sampleNote,/진행 주 포함/);
});
test('sparse daily 14 observations do not become a 14-day comparison',()=>{
 const points=Array.from({length:14},(_,i)=>[date(at('2026-09-10')+2*i),i<7?100:10]);
 const r=calculate(history('daily',points));assert.equal(r.velocity,null);assert.match(r.trendNote,/관측 4\/7일 · 이전 3\/7일 · 비교 표본 부족/);assert.equal(r.discountCount,0);
});
test('daily exact recent and preceding 7 calendar days give known mean difference',()=>{
 const h=history('daily',Array.from({length:14},(_,i)=>[date(at('2026-09-23')+i),i<7?100:10]));
 assert.equal(calculate(h).velocity,90);assert.equal(calculate(h).discountCount,13);
});
test('reversed input, invalid dates and out-of-horizon future values cannot distort KPI',()=>{
 const h=history('daily',Array.from({length:14},(_,i)=>[date(at('2026-09-23')+i),i<7?100:10]));
 const r=calculate(h);h.rank.reverse();h.price.reverse();h.rank.push({date:'2026-10-07',rank:1},{date:'2026-02-30',rank:1});
 h.price.push({date:'2026-10-07',discount_rate:20});assert.deepEqual(calculate(h),r);
});
test('daily boundary includes end and end-6, never borrows earlier observations for missing days',()=>{
 const points=Array.from({length:15},(_,i)=>[date(at('2026-09-22')+i),i<8?100:10]);
 const h=history('daily',points);assert.equal(calculate(h).velocity,90);
 h.rank=h.rank.filter(p=>p.date!=='2026-09-30');h.rank.coverage=h.price.coverage;assert.equal(calculate(h).velocity,null);assert.match(calculate(h).trendNote,/관측 6\/7일/);
});
test('selected horizon start cuts comparison, even with extra earlier samples',()=>{
 const r=calculate(history('daily',Array.from({length:14},(_,i)=>[date(at('2026-09-23')+i),i<7?100:10]),'2026-09-28'));
 assert.equal(r.velocity,null);assert.equal(r.sampleCount,9);assert.match(r.trendNote,/이전 2\/7일/);
});
test('weekly gaps and shortened start do not compare nonadjacent weeks',()=>{
 let h=history('weekly',[['2026-09-13',100],['2026-10-04',20],['2026-10-06',1]]);assert.equal(calculate(h).velocity,null);assert.equal(calculate(h).discountCount,0);
 h=history('weekly',[['2026-09-27',100],['2026-09-30',20],['2026-10-06',1]],'2026-09-28');assert.equal(calculate(h).velocity,null);
});
test('weekly sparse/partial saved observations compare representatives, never infer daily averages',()=>{
 const r=calculate(history('weekly',[['2026-09-22',100],['2026-09-29',40],['2026-10-06',1]]));assert.equal(r.velocity,60);assert.equal(r.discountDelta,-60);assert.equal(r.discountCount,1);assert.match(r.trendNote,/주별 마지막 관측 · 진행 주 제외/);
});
test('calendar Sunday current week excluded, Monday shifts to next finished week',()=>{
 const points=[['2026-09-20',90],['2026-09-27',50],['2026-10-04',10]];
 assert.equal(calculate(history('weekly',points,'2026-07-06','2026-10-04')).velocity,40);
 const monday=calculate(history('weekly',points,'2026-07-06','2026-10-05'));assert.equal(monday.velocity,40);assert.match(monday.trendNote,/2026-09-28 ~ 2026-10-04/);
});
test('short samples, duplicates, unknown unit and mismatched price scope remain explicit',()=>{
 const h=history('daily',[['2026-10-05',20],['2026-10-06',10]]);let r=calculate(h);assert.equal(r.stdDev,null);assert.equal(r.velocity,null);assert.match(r.sampleNote,/3개 이상 필요/);
 h.rank.push({...h.rank[0]});r=calculate(h);assert.equal(r.sampleCount,1);assert.equal(r.discountCount,0);
 h.price.coverage={...h.price.coverage,horizonEnd:'2026-10-05'};assert.match(calculate(h).discountNote,/범위가 다릅니다/);
 delete h.rank.coverage;assert.match(calculate(h).trendNote,/확인할 수 없습니다/);
});
test('discount transitions require exact previous date and a matching current price receipt',()=>{
 const h=history('daily',[['2026-10-02',80],['2026-10-04',60],['2026-10-05',40],['2026-10-06',20]]);h.price=h.price.filter(p=>p.date!=='2026-10-05');h.price.coverage=h.rank.coverage;
 const r=calculate(h);assert.equal(r.discountCount,1);assert.equal(r.discountDelta,-20);
});
test('leap year, year boundary and mode/range transitions use receipt dates',()=>{
 const h=history('daily',Array.from({length:14},(_,i)=>[date(at('2024-02-20')+i),i<7?50:20]),'2024-02-19','2024-03-04');assert.equal(calculate(h).velocity,30);
 const r=calculate(history('weekly',[['2025-12-21',80],['2025-12-28',40],['2026-01-04',20]],'2025-12-01','2026-01-05'));assert.equal(r.velocity,20);
 assert.equal(calculate(history('daily',[['2026-01-04',20]],'2025-12-01','2026-01-05')).velocity,null);
});

test('stale latest observations cannot move the comparison anchor away from horizonEnd',()=>{
 const daily=history('daily',Array.from({length:14},(_,i)=>[date(at('2026-09-21')+i),i<7?100:10]));
 assert.equal(calculate(daily).velocity,null);assert.match(calculate(daily).trendNote,/관측 5\/7일 · 이전 7\/7일/);
 const weekly=history('weekly',[['2026-09-20',100],['2026-09-27',10]]);assert.equal(calculate(weekly).velocity,null);assert.match(calculate(weekly).trendNote,/대표값 0\/1개/);
});
