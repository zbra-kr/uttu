const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), SSR = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
const Panel = load('src/components/briefing/CSDailyReviewCheck.tsx', { 'next/link': { __esModule: true, default: p => React.createElement('a', p) } }).default;
const render = values => SSR.renderToStaticMarkup(React.createElement(Panel, { state: { status: 'ready', scope: 'fixture', briefingDate: '2026-10-05', reviewDate: '2026-10-04', result: { total: 0, rows: [], excluded: 0 }, retry() {}, ...values } }));
test('source display is plain text, safe expansion and validated current product links only', () => {
  const rows = [{ id: 'a', product_id: 'p', musinsa_no: '123', rating: 2, review_date: '2026-10-04', review_text: '<script>window.attack=1</script>', product_name: '<img onerror=attack()>', brand_name: 'Fixture' }, { id: 'b', product_id: null, musinsa_no: 'javascript:attack()', rating: 1, review_date: '2026-10-04', review_text: null }];
  const html = render({ result: { rows, total: 30, excluded: 1 } });
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img'));
  assert.match(html, /<details><summary/); assert.match(html, /href="\/product\?no=123"/); assert.ok(!html.includes('javascript:'));
  for (const copy of ['현재 상품 상세 보기', '일부만 표시', '수집일이 아니며', '상품 식별', '2026-10-04', '1건은']) assert.ok(html.includes(copy), copy);
});
test('loading/error/retry/empty/invalid/signedout remain distinct and inactive renders nothing', () => {
  for (const [status, copy] of [['loading', '확인하는 중'], ['error', '정확한 건수'], ['invalid-date', '유효한'], ['signed-out', '로그인 후'], ['ready', '저장 리뷰가 없습니다']]) assert.ok(render({ status }).includes(copy));
  assert.ok(render({ status: 'error' }).includes('다시 확인'));
  assert.equal(render({ status: 'inactive' }), '');
});
