'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), load=require('./helpers/load-source.cjs');
const w=load('src/lib/weekly-review.ts'), v=load('src/lib/weekly-memo-view.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={brand:id(1),from:'2024-02-28',to:'2024-03-05',rating:'all',product:null,at:'2024-03-06T00:00:00.000Z'};
const evidence=[{id:id(2),product_id:id(3),musinsa_review_id:'fixture',product_name:'Fixture product',review_date:'2024-03-04',created_at:scope.at,rating:4}];
const body=(nextDate='2024-03-12',changes={})=>w.buildWeeklyMemo({scope,brandName:'Fixture brand',evidence,observation:'Observation\ncontinued prose',nextCheck:'Inspect sample\ncontinued check',nextDate,...changes});
test('canonical v1 supports multiline prose and all rating cohorts without a current-date or completion inference',()=>{
 for(const rating of ['all','low','high']){const b=body('2024-02-29',{scope:{...scope,rating},evidence:[{...evidence[0],rating:rating==='low'?2:4}]});assert.equal(v.parseWeeklyMemoNextDate(b),'2024-02-29');}
 assert.equal(v.parseWeeklyMemoNextDate(body()),'2024-03-12');
});
test('invalid, ambiguous, missing and altered structures never produce a date',()=>{
 const b=body();for(const changed of [
 b.replace('2024-03-12','2024-02-30'),b.replace('2024-03-12','2023-02-29'),b.replace('2024-03-12','2024-13-01'),b.replace('2024-03-12','0000-01-01'),b.replace('2024-03-12','2024-3-12'),b.replace('2024-03-12','2024-03-12T00:00:00Z'),
 b.replace('다음 확인일: 2024-03-12',''),b.replace('다음 확인일: 2024-03-12','다음 확인일: 2024-03-12\n다음 확인일: 2024-03-12'),
 b.replace('다음 확인일:','다음 확인일 :'),b.replace('다음 확인일:','다음 확인일：'),b.replace('Observation','Observation\n 다음 확인일 : 2000-01-01'),
 b.replace(w.WEEKLY_MEMO_HEADER,'[UTTU 상품 개선 검토 v2]'),b.replace(w.WEEKLY_MEMO_HEADER,''),`prefix\n${b}`,`${b}\nappend`,b.replaceAll('\n','\r\n'),
 b.replace('다음 확인: Inspect sample','Observation without field'),b.replace('조회 기준:','기준시각:'),b.replace('선택한 원문: 1건','선택한 원문: 2건'),
 b.replace('Observation','Observation\n브랜드: fake'),b.replace('Observation','Observation\n브랜드 : fake'),b.replace('/reviews/weekly?','https://evil.example/?'),b.replace('brand=','brand=bad'),b.replace('2024-03-06T00%3A00%3A00.000Z','9999-12-31T23%3A59%3A59.999Z'),
 b.replace('다음 확인일: 2024-03-12','다음 확인일: <script>alert(1)</script>'),b.replace('Observation','Observation\n다음 확인일: 2000-01-01'),
 ])assert.equal(v.parseWeeklyMemoNextDate(changed),null,changed);
});
test('loaded grouping is ascending by date, unknown last, ties retain cursor order and latest never mutates query rows',()=>{
 const rows=[{id:'new',body:body('2024-03-20')},{id:'tie-new',body:body('2024-03-12')},{id:'unknown',body:'Edited note'},{id:'tie-old',body:body('2024-03-12')},{id:'past',body:body('2024-02-29')}];const original=[...rows];
 const groups=v.groupLoadedWeeklyMemos(rows,'nextDate');assert.deepEqual(groups.map(g=>g.date),['2024-02-29','2024-03-12','2024-03-20',null]);assert.deepEqual(groups[1].rows.map(r=>r.id),['tie-new','tie-old']);assert.deepEqual(v.groupLoadedWeeklyMemos(rows,'latest')[0].rows,original);assert.deepEqual(rows,original);
 const more=v.groupLoadedWeeklyMemos([...rows,{id:'loaded-later',body:body('2024-03-12')}],'nextDate');assert.deepEqual(more[1].rows.map(r=>r.id),['tie-new','tie-old','loaded-later']);assert.deepEqual(v.groupLoadedWeeklyMemos([],'nextDate'),[]);
});
