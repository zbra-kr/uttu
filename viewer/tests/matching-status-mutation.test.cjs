const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://offline-matching.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-placeholder-key';
const MATCH_ID = '00000000-0000-0000-0000-000000000123';
const response = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
});

async function fixture(reply, run) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    const call = { url, init, headers: new Headers(init.headers), body: undefined };
    calls.push(call);
    assert.equal(url.origin, 'https://offline-matching.invalid', 'no live traffic');
    if (init.body !== undefined) call.body = JSON.parse(init.body);
    return reply(call);
  };
  try {
    const queries = load('src/lib/queries.ts');
    await run({ queries, calls });
  } finally { global.fetch = original; }
}

test('matching status: locked SDK version is the reviewed one', () => {
  assert.equal(require('@supabase/supabase-js/package.json').version, '2.106.0');
});

for (const status of ['confirmed', 'excluded']) {
  test(`matching status ${status}: exactly one requested id succeeds in one PATCH`, async () => {
    await fixture(() => response([{ id: MATCH_ID }]), async ({ queries, calls }) => {
      await queries.setMatchStatus(MATCH_ID, status);
      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.equal(call.init.method, 'PATCH');
      assert.equal(call.url.pathname, '/rest/v1/product_matches');
      assert.equal(call.url.searchParams.get('id'), `eq.${MATCH_ID}`);
      assert.equal(call.url.searchParams.get('select'), 'id');
      assert.match(call.headers.get('Prefer'), /return=representation/);
      assert.equal(call.headers.get('X-UTTU-Matching-Guard'), null);
      assert.equal(call.headers.get('X-Retry-Count'), null);
      assert.equal(call.body.status, status);
      if (status === 'confirmed') assert.ok(Number.isFinite(Date.parse(call.body.confirmed_at)));
      else assert.equal(Object.hasOwn(call.body, 'confirmed_at'), false);
    });
  });
}

for (const [name, reply] of [
  ['zero rows after concurrent replacement', call => /return=representation/.test(call.headers.get('Prefer') ?? '')
    ? response([]) : response(null, 204)],
  ['missing receipt: 204/null', () => response(null, 204)],
  ['wrong id', () => response([{ id: 'another-id' }])],
  ['multiple rows', () => response([{ id: MATCH_ID }, { id: MATCH_ID }])],
  ['missing id', () => response([{}])],
  ['null row', () => response([null])],
  ['object instead of array', () => response({ id: MATCH_ID })],
  ['returning permission denied', () => response({ code: '42501', message: 'synthetic denied' }, 403)],
  ['SDK-normalized 404 array', () => response([], 404)],
  ['SDK-normalized 404 empty', () => new Response('', { status: 404 })],
  ['server error', () => response({ message: 'synthetic failure' }, 500)],
  ['invalid JSON', () => new Response('{broken', { status: 200 })],
  ['transport failure after possible application', () => { throw new TypeError('synthetic failure'); }],
]) {
  test(`matching status: ${name} rejects without GET, retry or compensation`, async () => {
    await fixture(reply, async ({ queries, calls }) => {
      await assert.rejects(queries.setMatchStatus(MATCH_ID, 'confirmed'));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].init.method, 'PATCH');
      assert.equal(calls[0].headers.get('X-Retry-Count'), null);
    });
  });
}

test('matching status: other minimal-return mutation still accepts its original 204 receipt', async () => {
  await fixture(() => response(null, 204), async ({ queries, calls }) => {
    await queries.addManualMatch('own-product', 'competitor-product');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].url.searchParams.get('select'), null);
    assert.equal(calls[0].body.status, 'confirmed');
  });
});
