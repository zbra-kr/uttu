const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const uid = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const input = { body: '@사람 메모', mentioned_user_ids: [recipient], submission_id: id, send_teams: true };
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
function saved() { return { id, user_id: uid, body: input.body, mentioned_user_ids: [recipient], entity_type: null, entity_id: null, tags: [] }; }

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
