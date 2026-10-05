const { createClient } = require('@supabase/supabase-js');
const load = require('./load-source.cjs');
const vm = require('node:vm'), ts = require('typescript');
function parts(select) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < select.length; i++) {
    if (select[i] === '(') depth++; else if (select[i] === ')') depth--;
    else if (select[i] === ',' && depth === 0) { out.push(select.slice(start,i).trim()); start = i + 1; }
  }
  return [...out,select.slice(start).trim()];
}
function project(row, select) {
  return Object.fromEntries(parts(select).map(part => {
    const open = part.indexOf('('), name = (open < 0 ? part : part.slice(0,open)).split('!')[0];
    return [name, open < 0 ? row[name] : row[name] == null ? null : project(row[name],part.slice(open + 1,-1))];
  }));
}
function leaves(value) { return value && typeof value === 'object' ? Object.values(value).reduce((sum,v) => sum + leaves(v),0) : 1; }
function fixture(options = {}, baselineSource) {
  const calls = [], pending = [];
  const fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname !== '/rest/v1/ranking_snapshots') throw new Error('Unexpected fixture endpoint');
    const select = url.searchParams.get('select'), date = url.searchParams.get('snapshot_date')?.slice(3) || '2026-10-05';
    const call = { select, date, params: Object.fromEntries(url.searchParams), signal: init?.signal };
    calls.push(call);
    const respond = () => {
      if (call.signal?.aborted) throw new DOMException('fixture aborted','AbortError');
      if (options.errorDate === date && select !== 'snapshot_date') return new Response(JSON.stringify({
        message: 'fixture SDK error ' + date, code: 'FIXTURE', details: 'date read failed', hint: null,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      let rows;
      if (select === 'snapshot_date') rows = options.emptyLatest ? [] : [{ snapshot_date: date }];
      else {
        const day = Math.round((Date.parse(date) - Date.parse('2026-07-07')) / 86400000);
        rows = Array.from({ length: 302 }, (_,i) => ({
          rank_position: i + 1 + day % 3, musinsa_no: i + 1,
          product_name: '상품 ' + i, brand_name: '브랜드', category_code: url.searchParams.get('category_code')?.slice(3),
          gender_filter: url.searchParams.get('gender_filter')?.slice(3), age_filter: url.searchParams.get('age_filter')?.slice(3),
          list_price: 20000 + i, final_price: 15000 + i, discount_rate: 25,
          is_sold_out: false, review_count: i, review_score: 90, snapshot_date: date,
          product_id: 'fixture-product-' + i, products: { id: 'fixture-product-' + i, is_own: i % 2 === 0,
            thumbnail_url: '/fixture-' + i + '.jpg', brands: options.nullBrands ? null : { companies: { corp_name: '회사' } } },
        }));
        // An ineligible top-ranked row must not consume a capped slot.
        rows.unshift({ ...rows[0], rank_position: 0, musinsa_no: 999999, products: null });
        if (options.duplicateProduct) rows[2].musinsa_no = rows[1].musinsa_no;
        if (options.emptyDate === date || options.emptyAll) rows = [];
        if (select.includes('products!inner(')) rows = rows.filter(row => row.products !== null);
        rows = rows.sort((a,b) => a.rank_position - b.rank_position).slice(0,Number(url.searchParams.get('limit')))
          .map(row => project(row,select));
      }
      const body = JSON.stringify(rows);
      Object.assign(call,{ rows: rows.length, bodyBytes: Buffer.byteLength(body), valueFields: rows.reduce((sum,row) => sum + leaves(row),0) });
      return new Response(body,{ headers: { 'Content-Type': 'application/json' } });
    };
    if (!options.defer) return respond();
    return new Promise((resolve,reject) => {
      const finish = () => { try { resolve(respond()); } catch (error) { reject(error); } };
      pending.push(finish);
      call.signal?.addEventListener('abort',finish,{ once: true });
    });
  };
  const client = createClient('https://fixture.invalid','fixture-anon',{
    auth: { persistSession:false,autoRefreshToken:false,detectSessionInUrl:false }, global: { fetch },
  });
  let reader;
  if (baselineSource) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(baselineSource,{ compilerOptions: {
      module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
    } }).outputText,{ exports,require:id=>id==='./supabase/client'?{supabaseBrowser:()=>client}:{},console });
    reader = exports.fetchLatestRanking;
  } else reader = load('src/lib/queries.ts',{ './supabase/client': { supabaseBrowser:()=>client } }).fetchLatestRanking;
  return { reader,calls,pending };
}
module.exports = { fixture,project };
