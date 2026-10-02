const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const uid = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const entityId = 'period=today&category=000&gender=A&age=AGE_BAND_ALL';
const input = { entity_type: 'ranking_filter', entity_id: entityId, body: '@사람 메모', mentioned_user_ids: [recipient], submission_id: id, send_teams: true };
function api(previous) {
  const client = { auth: { getUser: async () => ({ data: { user: { id: uid } } }) }, from: table => {
    assert.equal(table, 'user_notes');
    return {
      insert: value => { assert.equal(value.id, id); return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) }) }; },
      select: () => ({ eq: () => ({ single: async () => ({ data: previous, error: null }) }) }),
    };
  } };
  return load('src/lib/queries-me.ts', { './supabase/client': { supabaseBrowser: () => client } });
}
function saved() { return { id, user_id: uid, body: input.body, mentioned_user_ids: [recipient], entity_type: input.entity_type, entity_id: input.entity_id, tags: [] }; }

test('uncertain save retry adopts exact same owned note ID before deduplicated notification', async () => {
  const queries = api(saved()); const old = global.fetch; let calls = 0;
  global.fetch = async (url, init) => {
    calls++; assert.equal(url, '/api/me/notes/notify-mentions');
    const body = JSON.parse(init.body); assert.equal(body.note_id, id); assert.equal(body.send_teams, true);
    return Response.json({ message: 'confirmed' });
  };
  try { const result = await queries.createNote(input); assert.equal(result.data.id, id); assert.equal(result.error, null); assert.equal(calls, 1); }
  finally { global.fetch = old; }
});
for (const [label, patch] of [
  ['another owner', { user_id: recipient }], ['different body', { body: 'other' }],
  ['different recipients', { mentioned_user_ids: [] }], ['different entity', { entity_id: 'other' }],
  ['different tags', { tags: ['other'] }],
]) test(`duplicate ID does not authorize ${label}`, async () => {
  const result = await api({ ...saved(), ...patch }).createNote(input);
  assert.equal(result.data, null); assert.equal(result.error, 'duplicate');
});

const sourceContext = {
  version: 1, kind: 'ranking', period: 'today', fromDate: '', toDate: '', selectedCategory: '000',
  gender: 'A', age: 'AGE_BAND_ALL', price: [0, 50], companies: [], brands: [], ownOnly: false,
  moverOnly: false, sort: 'rank', sortDir: 'asc', page: 1,
};
test('new notes persist nullable source snapshots alongside their selected entity', async () => {
  for (const context of [undefined, sourceContext]) {
    let inserted;
    const client = { auth: { getUser: async () => ({ data: { user: { id: uid } } }) }, from: () => ({
      insert: row => { inserted = row; return { select: () => ({ single: async () => ({ data: row, error: null }) }) }; },
    }) };
    const queries = load('src/lib/queries-me.ts', { './supabase/client': { supabaseBrowser: () => client } });
    const result = await queries.createNote({ body: '메모', entity_type: 'ranking_filter', entity_id: entityId, source_context: context });
    assert.equal(result.error, null);
    assert.deepEqual(inserted.source_context, context ?? null);
  }
});
test('JSONB object key order does not break source-context replay equality', async () => {
  const reversed = Object.fromEntries(Object.entries(sourceContext).reverse());
  const queries = api({ ...saved(), source_context: reversed });
  const result = await queries.createNote({ ...input, mentioned_user_ids: [], source_context: sourceContext });
  assert.equal(result.data, null); // recipients are still part of the immutable snapshot
  const oldFetch = global.fetch;
  global.fetch = async () => Response.json({ message: 'confirmed' });
  try {
    const same = await queries.createNote({ ...input, source_context: sourceContext });
    assert.equal(same.error, null);
    assert.equal(same.data.id, id);
  } finally { global.fetch = oldFetch; }
});
for (const [label, previous, next] of [
  ['new source on old note', null, sourceContext],
  ['removed source', sourceContext, null],
  ['different page', sourceContext, { ...sourceContext, page: 2 }],
  ['different pinned date', { ...sourceContext, resolvedFromDate: '2026-10-01', resolvedToDate: '2026-10-01' }, { ...sourceContext, resolvedFromDate: '2026-10-02', resolvedToDate: '2026-10-02' }],
]) test(`duplicate ID does not replay ${label}`, async () => {
  const result = await api({ ...saved(), source_context: previous }).createNote({ ...input, source_context: next });
  assert.equal(result.data, null);
  assert.equal(result.error, 'duplicate');
});

for (const [label, patch] of [
  ['unsupported shape', { source_context: { version: 2 } }],
  ['oversized company list', { source_context: { ...sourceContext, companies: Array(25).fill('name') } }],
  ['entity mismatch', { entity_id: 'period=7d&category=000&gender=A&age=AGE_BAND_ALL', source_context: sourceContext }],
  ['wrong entity kind', { entity_type: 'product', source_context: sourceContext }],
]) test(`invalid source context is rejected before saving or notifying: ${label}`, async () => {
  const client = { auth: { getUser: async () => assert.fail('do not proceed') }, from: () => assert.fail('do not write') };
  const queries = load('src/lib/queries-me.ts', { './supabase/client': { supabaseBrowser: () => client } });
  const result = await queries.createNote({ ...input, ...patch });
  assert.equal(result.data, null);
  assert.match(result.error, /랭킹 화면 정보를 저장할 수 없습니다/);
});
