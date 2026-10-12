import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as rules from './insights.mjs';
import {adaptScreenInput} from './screen-input-adapter.mjs';
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const moduleCode=html.split('<script type="module">')[1].split('</script>')[0].replace(/import .*?from '\.\/[^']+';/g,'');
function run(change='') {
 const elements=new Map();const document={getElementById(id){if(!elements.has(id))elements.set(id,{value:'all',innerHTML:'',textContent:''});return elements.get(id)},querySelectorAll(){return []}};
 const context=vm.createContext({document,Intl,adaptScreenInput,...rules});
 vm.runInContext(moduleCode,context);vm.runInContext(change+';render()',context);
 return {elements,context};
}
const viewNames=['planning','sales','margin','carryover','quality'];
const renderedValues=result=>[...result.elements.get('cards').innerHTML.matchAll(/<strong>(.*?)<\/strong>/g)].map(m=>m[1]);
const visible=result=>[...result.elements.values()].map(e=>e.innerHTML+' '+e.textContent).join(' ');
test('generated HTML calls actual adapter and preserves explicitly synthetic compatible disclaimer',()=>{
 assert.match(html,/import \{adaptScreenInput\} from '\.\/screen-input-adapter\.mjs'/);
 assert.match(html,/adaptScreenInput\(rows,contractInput,request\)/);
 assert.match(html,/compatible은 선언·합성 계약 일치이며 실제 ERP 검증이 아닙니다/);
 assert.doesNotMatch(html,/withheldInputs|failedBatchOutput/);
});
test('normal compatible CO fixture keeps all five existing designs and valid values',()=>{
 for(const view of viewNames){const r=run(`current='${view}';$('brand').value='CO'`);assert.equal(renderedValues(r)[0],'120');assert.match(r.elements.get('contractStatus').textContent,/compatible · 선언·합성 계약 일치/);assert.doesNotMatch(r.elements.get('body').innerHTML,/판단 보류/);assert.match(r.elements.get('chart').innerHTML,/class="bars"/);}
});
test('five generated views hold all numeric insights on source and VAT mismatch',()=>{
 for(const view of viewNames){const r=run(`current='${view}';$('brand').value='CO';contractInput.contract.source='SW_SALEINFO';contractInput.contract.amountField='SALEAMT';contractInput.contract.vatOperation='source_expression_divide_1.1'`);assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('body').innerHTML,/판단 보류.*CONTRACT_MISMATCH/);assert.match(r.elements.get('contractStatus').textContent,/계약 불일치/);assert.doesNotMatch(r.elements.get('chart').innerHTML,/class="bars"/);}
});
test('five generated views hold unknown contract definitions and missing receipt',()=>{
 for(const view of viewNames)for(const change of ["contractInput.contract.roundingPolicy=null","contractInput.contract.complete=false"]){const r=run(`current='${view}';$('brand').value='CO';${change}`);assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('body').innerHTML,/CONTRACT_UNKNOWN/);assert.match(r.elements.get('contractStatus').textContent,/미확인/);}
});
test('invalid source row batches suspend all five views with no raw diagnostic leakage',()=>{
 for(const view of viewNames)for(const change of ["contractInput.ledgerRows[0].SALEDT='2026-10-11'","contractInput.ledgerRows[0].amount=null","contractInput.ledgerRows[0].BRANDCD='RAW_DIAGNOSTIC_SENTINEL'"]){const r=run(`current='${view}';$('brand').value='CO';${change};contractInput.ledgerRows[0].diagnosticSecret='RAW_DIAGNOSTIC_SENTINEL'`);assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('body').innerHTML,/BATCH_(MISMATCH|UNKNOWN)/);assert.doesNotMatch(visible(r),/RAW_DIAGNOSTIC_SENTINEL|withheldInputs|diagnosticSecret/);}
});
test('category date and scope mismatches hold each view and report safe scope code',()=>{
 for(const view of viewNames)for(const change of ["contractInput.bindings[0].marketScope.category='RAW_DIAGNOSTIC_SENTINEL'","rows[0].marketDate='2026-10-09'","contractInput.bindings[0].marketScope.age='other'"]){const r=run(`current='${view}';$('brand').value='CO';${change}`);assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('body').innerHTML,/SCOPE_MISMATCH/);assert.doesNotMatch(visible(r),/RAW_DIAGNOSTIC_SENTINEL/);}
});
test('kids-parent key collapse and ambiguous mappings are blocked at screen input',()=>{
 for(const change of ["contractInput.mappings[3].uttuBrand='CO'","contractInput.mappings[3].productId=contractInput.mappings[0].productId","contractInput.bindings.push(contractInput.bindings[0])"]){const r=run(`$('brand').value='CO';${change}`);assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('body').innerHTML,/(MAPPING|BINDING)_MISMATCH/);}
});
test('missing binding or noneligible source product cannot be rescued by verified mappings',()=>{
 for(const change of ["contractInput.bindings=[]","contractInput.ledgerRows=contractInput.ledgerRows.filter(r=>r.BRANDCD!=='CO')"]){const r=run(`$('brand').value='CO';${change}`);assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('body').innerHTML,/(BINDING|PRODUCT)_UNKNOWN/);}
});
test('adapter has allowlisted projection and status only; raw reports and extra fields never return',()=>{
 const r=run();vm.runInContext("rows[0].diagnostics={private:'RAW_DIAGNOSTIC_SENTINEL'};rows[0].erpWindow.private='RAW_DIAGNOSTIC_SENTINEL';rows[0].erpWindow.start={private:'RAW_DIAGNOSTIC_SENTINEL'};contractInput.ledgerRows[0].amount=null;contractInput.ledgerRows[0].private='RAW_DIAGNOSTIC_SENTINEL'",r.context);
 const out=vm.runInContext('adaptScreenInput(rows,contractInput,screenRequest)',r.context);
 assert.doesNotMatch(JSON.stringify(out),/RAW_DIAGNOSTIC_SENTINEL|withheldInputs|included|excluded|diagnostics|private/);
 assert.equal(out.rows[0].contractGate.status,'unknown');assert.equal(out.contractSummary.validN,0);
});
test('raw markup in allowed presentation strings escaped and malformed gate codes never echoed',()=>{
 const r=run("$('brand').value='CO';rows[0].name='<script>RAW_MARKUP</script>'");assert.doesNotMatch(r.elements.get('body').innerHTML,/<script>/);assert.match(r.elements.get('body').innerHTML,/&lt;script&gt;/);
 assert.equal(rules.contractGateMessage({codes:['RAW_DIAGNOSTIC_SENTINEL'],summary:'RAW_DIAGNOSTIC_SENTINEL'}),'데이터 계약 미확인');
});
test('missing synthetic envelope and malformed bindings fail closed instead of throwing',()=>{
 assert.equal(adaptScreenInput([],null).contractSummary.status,'unknown');
 const r=run("$('brand').value='CO';contractInput.bindings=[null,{}];contractInput.syntheticOnly=false");assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('body').innerHTML,/INPUT_UNKNOWN/);
});
test('normal zero and partial unavailable distinctions survive contract adapter integration',()=>{
 const zero=run("$('brand').value='CO';rows[0].sale=0;rows[0].peerDiscount=0;current='margin'");assert.equal(renderedValues(zero)[0],'0');assert.equal(renderedValues(zero)[2],'0%');
 const partial=run("rows[0].sale=null");assert.equal(renderedValues(partial)[0],'미확인');assert.match(partial.elements.get('coverage').textContent,/상태 partial/);
});
test('exact prior-ledger/current-screen counterexample is blocked in all five generated views',()=>{
 for(const view of viewNames){
  const r=run(`current='${view}';$('brand').value='CO';contractInput.contract.period={start:'2026-09-27',end:'2026-10-03'};contractInput.expectedContract.period={start:'2026-09-27',end:'2026-10-03'};contractInput.ledgerRows.forEach(row=>row.SALEDT='2026-10-03')`);
  assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('body').innerHTML,/판단 보류.*REQUEST_MISMATCH/);
  assert.match(r.elements.get('contractStatus').textContent,/현재 화면 요청 기간/);assert.doesNotMatch(r.elements.get('chart').innerHTML,/class="bars"/);
 }
});
test('coherent input contracts still must match independent screen season channel grain and brand request',()=>{
 const cases=[
  "contractInput.contract.channelScope=contractInput.expectedContract.channelScope='OTHER-FIXTURE-CHANNEL'",
  "contractInput.contract.unit=contractInput.expectedContract.unit='KRW_decimal'",
  "contractInput.contract.season={year:'2026',names:['봄']};contractInput.expectedContract.season={year:'2026',names:['봄']};contractInput.ledgerRows.forEach(row=>row.SEASONNM='봄')",
  "contractInput.contract.grain.push('SIZECD');contractInput.expectedContract.grain.push('SIZECD');contractInput.ledgerRows.forEach(row=>row.SIZECD='M')",
  "contractInput.contract.brands=['LE'];contractInput.expectedContract.brands=['LE'];contractInput.ledgerRows=contractInput.ledgerRows.filter(row=>row.BRANDCD==='LE')",
 ];
 for(const change of cases){const r=run(`$('brand').value='CO';${change}`);assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('body').innerHTML,/REQUEST_MISMATCH/);}
});
test('self-consistent mutated category and product bindings cannot replace screen requested binding',()=>{
 for(const change of [
  "contractInput.bindings[0].categoryCrosswalk.category=contractInput.bindings[0].marketScope.category='OTHER-FIXTURE-CATEGORY'",
  "contractInput.bindings[0].STYLECD='OTHER-FIXTURE-STYLE';contractInput.mappings[0].STYLECD='OTHER-FIXTURE-STYLE';contractInput.ledgerRows[0].STYLECD='OTHER-FIXTURE-STYLE'",
  "contractInput.bindings[0].erpScope.store=contractInput.bindings[0].marketScope.store='OTHER-FIXTURE-STORE'",
 ]){const r=run(`$('brand').value='CO';${change}`);assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('body').innerHTML,/REQUEST_MISMATCH/);}
});
test('exact null display and empty binding counterexample returns safe unknown instead of TypeError',()=>{
 const r=run();const input=vm.runInContext('contractInput',r.context),request=vm.runInContext('screenRequest',r.context);
 input.bindings=[{}];let result;assert.doesNotThrow(()=>{result=adaptScreenInput([null],input,request)});
 assert.equal(result.contractSummary.status,'unknown');assert.equal(result.rows.length,1);
 assert.ok(result.rows[0].contractGate.codes.includes('INPUT_UNKNOWN'));assert.ok(result.rows[0].contractGate.codes.includes('BINDING_UNKNOWN'));
 assert.doesNotMatch(JSON.stringify(result),/TypeError|withheldInputs/);
});
test('malformed display records and malformed binding identities fail closed across generated views',()=>{
 for(const view of viewNames){const r=run(`current='${view}';rows.splice(0,rows.length,null);contractInput.bindings=[{}]`);assert.equal(renderedValues(r)[0],'미확인');assert.match(r.elements.get('contractStatus').textContent,/INPUT_UNKNOWN/);assert.doesNotMatch(visible(r),/TypeError|withheldInputs/);}
 const r=run();const input=vm.runInContext('contractInput',r.context),request=vm.runInContext('screenRequest',r.context);
 input.bindings=[undefined,null,7,{},[],{displayBrand:'CO'}];
 for(const row of [null,undefined,7,false,[],{},'CO']){const out=adaptScreenInput([row],input,request);assert.equal(out.contractSummary.status,'unknown');assert.equal(out.contractSummary.validN,0);}
 const sparse=adaptScreenInput(new Array(1),input,request);assert.equal(sparse.rows.length,1);assert.equal(sparse.contractSummary.status,'unknown');
});
test('missing screen request never treats matching input pair as compatible',()=>{
 const r=run();const rows=vm.runInContext('rows',r.context),input=vm.runInContext('contractInput',r.context);
 const out=adaptScreenInput(rows,input);assert.equal(out.contractSummary.validN,0);assert.ok(out.rows[0].contractGate.codes.includes('REQUEST_UNKNOWN'));
});
test('normal filtered brand and item scope remains compatible after request binding fix',()=>{
 for(const brand of ['CO','LE','WA']){const r=run(`$('brand').value='${brand}'`);assert.match(r.elements.get('contractStatus').textContent,/compatible · 선언·합성 계약 일치/);assert.notEqual(renderedValues(r)[0],'미확인');}
 const r=run("$('brand').value='CO';$('item').value='후드티'");assert.equal(renderedValues(r)[0],'120');assert.doesNotMatch(r.elements.get('body').innerHTML,/REQUEST_(MISMATCH|UNKNOWN)/);
});
