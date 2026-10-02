const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NextRequest } = require('next/server');
const load = require('./helpers/load-source.cjs');

const origin = 'https://uttu.example.test';
const uid = '11111111-1111-4111-8111-111111111111';
const otherUid = '22222222-2222-4222-8222-222222222222';
const row = { user_id: uid, eligible: true, status: 'pending', step: 0 };

function route(options = {}) {
  const calls = [];
  const api = load('src/app/api/me/onboarding/route.ts', {
    '@/lib/supabase/server': { supabaseServer: async () => {
      if (options.serverError) throw new Error('private server details');
      return {
        auth: { getUser: async () => ({ data: { user: Object.hasOwn(options, 'user') ? options.user : { id: uid } }, error: options.authError || null }) },
        rpc: async (...args) => {
          calls.push(args);
          if (options.rpcThrows) throw new Error('private RPC details');
          return { data: Object.hasOwn(options, 'data') ? options.data : [row], error: options.error || null };
        },
      };
    } },
  });
  return { ...api, calls };
}

function request(body, options = {}) {
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...options.headers };
  for (const [name, value] of Object.entries(headers)) if (value === null) delete headers[name];
  return new NextRequest(`${origin}/api/me/onboarding`, {
    method: options.method || 'PATCH', headers,
    body: options.raw ?? JSON.stringify(body),
  });
}

for (const method of ['GET', 'PATCH', 'POST']) {
  test(`${method} rejects unauthenticated access without any RPC`, async () => {
    const api = route({ user: null });
    const response = await api[method](request(method === 'POST' ? { action: 'replay' } : { status: 'pending', step: 0 }));
    assert.equal(response.status, 401);
    assert.deepEqual(api.calls, []);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  test(`${method} rejects failed auth verification even if a user is returned`, async () => {
    const api = route({ authError: { message: 'invalid JWT' } });
    assert.equal((await api[method](request({ status: 'pending', step: 0 }))).status, 401);
    assert.deepEqual(api.calls, []);
  });
}

test('GET returns only the verified own state and is never cached', async () => {
  const api = route({ data: [{ ...row, internal_notes: 'not exposed' }] });
  const response = await api.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { userId: uid, eligible: true, status: 'pending', step: 0 });
  assert.deepEqual(api.calls, [['get_my_onboarding']]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('vary'), 'Cookie');
});

for (const state of [
  { ...row, eligible: false, status: 'legacy' },
  { ...row, eligible: false, status: 'pending', step: 3 },
  { ...row, status: 'completed', step: 5 },
  { ...row, status: 'skipped', step: 2 },
]) {
  test(`GET preserves ${state.status}, eligibility=${state.eligible}, step=${state.step}`, async () => {
    assert.deepEqual(await (await route({ data: [state] }).GET()).json(), {
      userId: uid, eligible: state.eligible, status: state.status, step: state.step,
    });
  });
}

for (const status of ['pending', 'completed', 'skipped']) {
  test(`PATCH ${status} sends only state arguments, never a browser-supplied owner`, async () => {
    const api = route({ data: [{ ...row, status, step: 5 }] });
    const response = await api.PATCH(request({ status, step: 5 }));
    assert.equal(response.status, 200);
    assert.deepEqual(api.calls, [['save_my_onboarding', { p_status: status, p_step: 5, p_replay: false }]]);
    assert.deepEqual(await response.json(), { userId: uid, eligible: true, status, step: 5 });
  });
}

test('POST explicitly replays legacy state without changing eligibility', async () => {
  const api = route({ data: [{ ...row, eligible: false }] });
  const response = await api.POST(request({ action: 'replay' }, { method: 'POST' }));
  assert.equal(response.status, 200);
  assert.deepEqual(api.calls, [['save_my_onboarding', { p_status: 'pending', p_step: 0, p_replay: true }]]);
  assert.deepEqual(await response.json(), { userId: uid, eligible: false, status: 'pending', step: 0 });
});

for (const body of [
  null, [], true, 'pending', {}, { status: 'legacy', step: 0 }, { status: 'unknown', step: 0 },
  { status: 'pending', step: -1 }, { status: 'pending', step: 6 }, { status: 'pending', step: 0.5 },
  { status: 'pending', step: '1' }, { status: 'pending', step: null }, { status: 'pending' },
  { status: 'pending', step: 0, userId: otherUid }, { status: 'pending', step: 0, eligible: true },
  { status: 'pending', step: 0, replay: true },
]) {
  test(`PATCH rejects invalid or extra fields: ${JSON.stringify(body)}`, async () => {
    const api = route();
    assert.equal((await api.PATCH(request(body))).status, 400);
    assert.deepEqual(api.calls, []);
  });
}

for (const body of [{}, { action: 'start' }, { action: 'replay', userId: otherUid }, { action: 'replay', step: 0 }]) {
  test(`POST rejects invalid replay payload: ${JSON.stringify(body)}`, async () => {
    const api = route();
    assert.equal((await api.POST(request(body))).status, 400);
    assert.deepEqual(api.calls, []);
  });
}

for (const raw of ['{', 'null', ' '.repeat(1025)]) {
  test(`malformed/oversized JSON is rejected (${raw.length} characters)`, async () => {
    const api = route();
    assert.equal((await api.PATCH(request(null, { raw }))).status, 400);
    assert.deepEqual(api.calls, []);
  });
}

for (const headers of [
  { Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: null },
  { Origin: `${origin}/` }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' },
  { 'Content-Type': 'text/plain' }, { 'Content-Type': null },
]) {
  test(`mutations reject cross-origin/non-JSON input: ${JSON.stringify(headers)}`, async () => {
    for (const method of ['PATCH', 'POST']) {
      const api = route();
      assert.equal((await api[method](request(method === 'POST' ? { action: 'replay' } : { status: 'pending', step: 0 }, { headers }))).status, 403);
      assert.deepEqual(api.calls, []);
    }
  });
}

test('same-origin JSON permits charset and missing optional fetch metadata', async () => {
  const response = await route().PATCH(request({ status: 'pending', step: 0 }, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Sec-Fetch-Site': null },
  }));
  assert.equal(response.status, 200);
});

for (const data of [
  null, [], [row, row], row, [{ ...row, user_id: otherUid }], [{ ...row, status: 'unknown' }],
  [{ ...row, eligible: 'true' }], [{ ...row, step: 6 }], [{ ...row, step: -1 }],
  [{ ...row, status: 'legacy' }], [{ ...row, status: 'legacy', eligible: false, step: 1 }],
]) {
  test(`unexpected RPC data fails closed: ${JSON.stringify(data)}`, async () => {
    const api = route({ data });
    assert.equal((await api.GET()).status, 503);
    assert.equal((await api.PATCH(request({ status: 'pending', step: 0 }))).status, 503);
  });
}

for (const options of [
  { error: { code: 'PGRST202', message: 'schema private implementation' } },
  { serverError: true }, { rpcThrows: true },
]) {
  test(`missing migration or infrastructure error never fabricates enrollment: ${JSON.stringify(options)}`, async () => {
    const api = route(options);
    for (const method of ['GET', 'PATCH', 'POST']) {
      const response = await api[method](request(method === 'POST' ? { action: 'replay' } : { status: 'pending', step: 0 }));
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.deepEqual(Object.keys(body), ['error']);
      assert.doesNotMatch(body.error, /private|schema|JWT/);
    }
  });
}

for (const [code, status] of [['42501', 403], ['22023', 400]]) {
  test(`mutation safely maps database error ${code}`, async () => {
    const api = route({ error: { code, message: 'private database details' } });
    const response = await api.PATCH(request({ status: 'pending', step: 0 }));
    assert.equal(response.status, status);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private/);
  });
}
