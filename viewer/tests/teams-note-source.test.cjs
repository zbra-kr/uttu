const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const { resolveNoteSource } = load('src/lib/notes/source.ts');
const noteId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const note = type => ({ id: noteId, entity_type: type, entity_id: entityId });
function database(result = {}) {
  const calls = [];
  return { calls, from: table => { calls.push([table]); return { select: columns => {
    calls.at(-1).push(columns); return { eq: (key, value) => {
      calls.at(-1).push(key, value); return { maybeSingle: async () => result };
    } };
  } }; } };
}

test('product UUID resolves to canonical product number, source title and exact note', async () => {
  const sb = database({ data: { musinsa_no: '1234567', name: '셔츠 & 재킷' } });
  const source = await resolveNoteSource(sb, { ...note('product'), href: 'https://evil.test', title: 'spoof' });
  assert.equal(source.title, '상품 상세 (셔츠 & 재킷)');
  const url = new URL(source.path, 'https://uttu.test');
  assert.equal(url.pathname, '/product'); assert.equal(url.searchParams.get('no'), '1234567');
  assert.equal(url.searchParams.get('note'), noteId); assert.equal(url.searchParams.get('notes'), 'open');
  assert.deepEqual(sb.calls, [['products', 'musinsa_no,name', 'id', entityId]]);
});

for (const [type, table, field, title] of [
  ['brand', 'brands', 'name', '브랜드 상세'], ['company', 'companies', 'corp_name', '회사 상세'],
]) test(`${type} uses authenticated source data, never caller labels`, async () => {
  const sb = database({ data: { [field]: 'trusted name' } });
  const source = await resolveNoteSource(sb, note(type));
  assert.equal(source.title, `${title} (trusted name)`);
  assert.equal(new URL(source.path, 'https://uttu.test').searchParams.get('id'), entityId);
  assert.deepEqual(sb.calls, [[table, field, 'id', entityId]]);
});

for (const [kind, data] of [
  ['deleted', {}], ['query denied', { error: { message: 'private error' } }],
  ['malformed product number', { data: { musinsa_no: '//evil.example', name: 'private' } }],
]) test(`${kind} keeps the secure memo fallback`, async () => {
  const source = await resolveNoteSource(database(data), note('product'));
  assert.deepEqual(source, { title: '상품 상세', path: `/me/notes/${noteId}` });
});

test('unsupported sources and malformed entities cannot manufacture a destination', async () => {
  const sb = database();
  for (const entity_type of ['review', 'magazine', 'anomaly', '//evil.test', null]) {
    const source = await resolveNoteSource(sb, note(entity_type));
    assert.equal(source.path, `/me/notes/${noteId}`);
  }
  for (const entity_id of ['../../admin', 'https://evil.test', null]) {
    assert.equal((await resolveNoteSource(sb, { ...note('product'), entity_id })).path, `/me/notes/${noteId}`);
  }
  assert.deepEqual(sb.calls, []);
});

test('lookup exceptions do not expose provider errors or prevent reading the memo', async () => {
  assert.deepEqual(await resolveNoteSource({ from: () => { throw new Error('private'); } }, note('product')),
    { title: '상품 상세', path: `/me/notes/${noteId}` });
});

test('legacy ranking cannot restore custom dates that were never persisted', async () => {
  const sb = database();
  const source = await resolveNoteSource(sb, { ...note('ranking_filter'),
    entity_id: 'age=AGE_BAND_ALL&category=000&gender=A&period=custom' });
  assert.equal(source.path, `/me/notes/${noteId}`);
  assert.deepEqual(sb.calls, []);
});

for (const name of ['(stub)', '', null]) test(`stub product title ${JSON.stringify(name)} matches the latest visible ranking title`, async () => {
  const sb = database({ data: { musinsa_no: '1234567', name } });
  const from = sb.from;
  sb.from = table => table !== 'ranking_snapshots' ? from(table) : ({ select: columns => {
    assert.equal(columns, 'product_name'); return { eq: (column, value) => {
      assert.equal(column, 'musinsa_no'); assert.equal(value, 1234567);
      const order = { order: () => order, limit: async limit => {
        assert.equal(limit, 1); return { data: [{ product_name: '실제 상품명' }] };
      } }; return order;
    } };
  } });
  assert.equal((await resolveNoteSource(sb, note('product'))).title, '상품 상세 (실제 상품명)');
});

test('source query returns through the compact RLS-bound permalink after sign-in and Teams setup', async () => {
  const { safeAuthRedirect, microsoftOAuthCredentials } = load('src/lib/auth/oauth.ts');
  const { safeTeamsSetupNext, teamsSetupPath } = load('src/lib/teams/setup-navigation.ts');
  const { rankingSourceFromEntity, rankingContextToSearchParams } = load('src/lib/notes/ranking-context.ts');
  const ranking = rankingSourceFromEntity('age=AGE_BAND_20&category=001&gender=M&period=7d');
  delete ranking.legacy;
  ranking.brands = ['브랜드 & 테스트']; ranking.price = [2, 30];
  ranking.resolvedFromDate = '2026-09-25'; ranking.resolvedToDate = '2026-10-01';
  const query = rankingContextToSearchParams(ranking); query.set('note', noteId); query.set('notes', 'open');
  const source = `/ranking?${query}`;
  const compact = `/me/notes/${noteId}`;
  assert.equal(safeAuthRedirect(source), compact);
  assert.equal(safeTeamsSetupNext(source), compact);
  assert.equal(new URL(teamsSetupPath(source), 'https://uttu.test').searchParams.get('next'), compact);
  const credentials = microsoftOAuthCredentials('https://uttu.test', source, true);
  assert.equal(new URL(credentials.options.redirectTo).searchParams.get('next'), compact);
});
