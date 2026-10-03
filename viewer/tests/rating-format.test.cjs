const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-source.cjs');
const { formatFiveStarRating: format, isLowFiveStarRating: low } = load('src/lib/rating-format.ts');

for (const [value, expected, warning] of [
  [4.9, '4.9/5', false], [5, '5/5', false], [0, '0/5', true],
  [2.9, '2.9/5', true], [3, '3/5', false], [4.87, '4.87/5', false],
  [null, '—', false], [undefined, '—', false],
  [98, '확인 필요', false], [5.1, '확인 필요', false], [-1, '확인 필요', false],
  [NaN, '확인 필요', false], [Infinity, '확인 필요', false],
  ['4.9', '확인 필요', false], ['', '확인 필요', false],
]) {
  test(`five-star formatting and warnings: ${String(value)}`, () => {
    assert.equal(format(value), expected);
    assert.equal(low(value), warning);
  });
}

// Source contracts supplement executable helper tests; browser/layout QA is separate.
const read = file => fs.readFileSync(path.join(__dirname, '../src/app/(app)', file), 'utf8');
test('both review product tables use five-star labels, formatting and warnings', () => {
  const src = read('reviews/page.tsx');
  assert.equal((src.match(/formatFiveStarRating\(p.satisfaction_score\)/g) || []).length, 2);
  assert.equal((src.match(/isLowFiveStarRating\(p.satisfaction_score\)/g) || []).length, 3);
  assert.doesNotMatch(src, /satisfaction_score[^\n]*(?:< 60|\}%)/);
  assert.equal((src.match(/>평점<\/span>/g) || []).length, 2);
});
test('desktop and mobile product detail preserve zero and keep percentage score separate', () => {
  for (const file of ['product/page.tsx', 'product/MobileProductDetailView.tsx']) {
    const src = read(file);
    assert.match(src, /formatFiveStarRating\(detail.satisfaction_score\)/);
    assert.match(src, /detail.review_score != null \? `\$\{detail.review_score\}%` : '—'/);
    assert.doesNotMatch(src, /formatFiveStarRating\(detail.review_score/);
  }
});
test('company, home, and matching product/aggregate ratings are explicitly out of five', () => {
  for (const [file, values] of [
    ['company/page.tsx', ['b.avg_score', 'p.satisfaction_score']],
    ['company/MobileCompanyDetailView.tsx', ['b.avg_score', 'p.satisfaction_score']],
    ['page.tsx', ['b.avg_satisfaction']], ['MobileHomeView.tsx', ['b.avg_satisfaction']],
    ['matching/page.tsx', ['m.competitor_satisfaction', 'p.satisfaction_score', 'selectedProduct.satisfaction_score']],
  ]) {
    for (const value of values) assert.ok(read(file).includes(`formatFiveStarRating(${value})`), `${file}: ${value}`);
  }
});
