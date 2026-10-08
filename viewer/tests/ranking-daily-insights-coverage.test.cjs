const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
const View = load('src/components/ranking/RankingDailyInsights.tsx', {
  'next/link': { __esModule: true, default: props => React.createElement('a', props) },
  '@/lib/queries': { CATEGORY_MAP: { '000': '전체' }, AGE_MAP: { AGE_BAND_ALL: '전체' } },
  '@/lib/queries-ranking-daily': { fetchRankingDaily() { throw Error('render must not query'); } },
  './RankingDailyProvider': { useRankingDailySession: () => null },
}).default;
const scope = { version: 1, kind: 'ranking', period: 'today', fromDate: '', toDate: '',
  resolvedFromDate: '2026-10-07', resolvedToDate: '2026-10-07',
  selectedCategory: '000', gender: 'A', age: 'AGE_BAND_ALL', price: [0, 50],
  companies: [], brands: [], ownOnly: false, moverOnly: false, sort: 'rank', sortDir: 'asc', page: 1 };
const request = { categoryCode: '000', genderFilter: 'A', ageFilter: 'AGE_BAND_ALL', date: '2026-10-07' };
const row = (id, date, patch = {}) => ({ store_code: 'musinsa', snapshot_date: date,
  category_code: '000', gender_filter: 'A', age_filter: 'AGE_BAND_ALL', musinsa_no: String(id),
  rank_position: id, product_name: 'Stored item ' + id, final_price: 10000, discount_rate: 10, ...patch });
const data = count => ({ request, date: '2026-10-07', previousDate: '2026-10-06',
  current: Array.from({ length: count }, (_, i) => row(i + 1, '2026-10-07')),
  previous: Array.from({ length: count }, (_, i) => row(i + 1, '2026-10-06')) });
const render = (value, compact = false) => renderToStaticMarkup(React.createElement(View, {
  scope, compact, load: { key: 'fixture', loading: false, error: false, data: value },
}));
function truthful(html) {
  assert.match(html, /조회 조건: 순위 300위 이내/);
  assert.doesNotMatch(html, /순위 1–300 관측 범위|수집 실패|수집 누락|Top ?300 수집 완료|전체 300개 수집/);
  assert.match(html, /전체 수집 완료 여부는 확인되지 않습니다/);
}
for (const count of [100, 101, 300]) test(`${count} clean observations describe a query ceiling, never collection completeness`, () => {
  for (const compact of [false, true]) {
    const html = render(data(count), compact);
    truthful(html);
    assert.match(html, new RegExp(`일치 ${count}개`));
    assert.match(html, /2026-10-07/); assert.match(html, /2026-10-06/);
    assert.doesNotMatch(html, /일부 자료를 비교할 수 없습니다|조회 상한/);
  }
});
test('unknown metrics and ambiguous rows retain partial comparison warnings without claiming collection failure', () => {
  const value = data(101);
  value.current[0].final_price = null;
  value.current[1].rank_position = 3; // duplicate rank: excludes both ambiguous rows
  const html = render(value);
  truthful(html);
  assert.match(html, /일부 자료를 비교할 수 없습니다/);
  assert.match(html, /판별 불가\/중복 2행/);
  assert.match(html, /가격\/할인 미확인 1개/);
});
test('missing and capped observations retain their existing warnings with unknown completeness', () => {
  const missingCurrent = data(0), missingPrevious = { ...data(101), previous: [] };
  for (const [value, message] of [[missingCurrent, /관측이 없습니다/],
    [missingPrevious, /더 오래된 날짜로 대체하지 않습니다/], [data(1000), /조회 상한에 도달/]]) {
    const html = render(value);
    truthful(html); assert.match(html, message);
  }
});
