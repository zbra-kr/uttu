const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const { NextRequest } = require('next/server');
const identity = load('src/lib/teams/identity.ts');
const configModule = load('src/lib/teams/config.ts', { './identity': identity });
const authorId = '11111111-1111-4111-8111-111111111111';
const recipientId = '22222222-2222-4222-8222-222222222222';
const noteId = '33333333-3333-4333-8333-333333333333';
const deliveryId = '44444444-4444-4444-8444-444444444444';
const user = { id: authorId, identities: [{ provider: 'azure', identity_data: {
  iss: `https://login.microsoftonline.com/${configModule.COMPANY_TENANT}/v2.0`,
  custom_claims: { oid: authorId, tid: configModule.COMPANY_TENANT },
} }] };
const origin = 'https://uttu.example.test';
process.env.NEXT_PUBLIC_APP_URL = origin;

function scenario(overrides = {}) {
  const note = { id: noteId, user_id: authorId, body: '@사람 메모', mentioned_user_ids: [recipientId], created_at: new Date().toISOString(), ...overrides.note };
  const calls = []; let sends = 0; let status = 'pending';
  const row = { id: deliveryId, recipient_id: recipientId, body_snapshot: note.body,
    connection_version: '55555555-5555-4555-8555-555555555555',
    recipient_tenant_id: configModule.COMPANY_TENANT, recipient_object_id: recipientId };
  const sb = {
    auth: { getUser: async () => ({ data: { user: overrides.noUser ? null : user } }) },
    from: table => {
      assert.equal(table, 'user_notes');
      return { select: () => ({ eq: () => ({ single: async () => ({ data: note }) }) }) };
    },
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (overrides.rpc) { const result = await overrides.rpc(name, args); if (result) return result; }
      if (name === 'uttu_teams_prepare_mentions') return { data: [{ ...row, status }] };
      if (name === 'uttu_teams_claim_delivery') {
        if (status !== 'pending') return { data: [] };
        status = 'claimed'; return { data: [row] };
      }
      if (name === 'uttu_teams_begin_send') return { data: !overrides.boundaryRejected };
      if (name === 'uttu_teams_finish_delivery') { status = args.p_status; return { data: true }; }
      if (name === 'uttu_teams_get_delivery_status') return { data: [{ ...row, status }] };
      assert.fail(name);
    },
  };
  const route = load('src/app/api/me/notes/notify-mentions/route.ts', {
    '@/lib/supabase/server': { supabaseServer: async () => sb },
    '@/lib/teams/config': { ...configModule, teamsConfig: () => overrides.disabled ? null : { origin, tenantId: configModule.COMPANY_TENANT } },
    '@/lib/teams/identity': identity,
    '@/lib/teams/oauth': { getTeamsAuthorGrant: async () => overrides.noGrant ? null : ({ accessToken: 'fake',
      connectionVersion: overrides.changedGrant ? '66666666-6666-4666-8666-666666666666' : row.connection_version }) },
    '@/lib/teams/graph': { sendAuthorMention: async input => {
      sends++;
      assert.equal(input.authenticatedAuthor.userId, authorId);
      assert.equal(input.recipient.userId, recipientId);
      assert.equal(input.authorActionConfirmed, true);
      assert.match(input.text, new RegExp(`/me/notes/${noteId}`));
      if (!await input.authorizeMessage()) return { status: 'not_sent', reason: 'not_authorized' };
      return overrides.outcome || { status: 'sent', messageId: 'message', chatId: 'chat' };
    } },
  });
  const request = (patch = {}, headers = {}) => new NextRequest(origin + '/api/me/notes/notify-mentions', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ note_id: noteId, expected_body: note.body, recipient_ids: [recipientId], send_teams: true, ...patch }),
  });
  return { route, request, calls, sends: () => sends };
}

test('route sends as authenticated author, persists confirmed result and replay sends once', async () => {
  const s = scenario();
  let response = await s.route.POST(s.request());
  assert.equal(response.status, 200); assert.equal((await response.json()).sent, 1);
  const prepare = s.calls.find(([name]) => name === 'uttu_teams_prepare_mentions')[1];
  assert.equal(prepare.p_expected_body, '@사람 메모');
  assert.deepEqual(prepare.p_expected_recipient_ids, [recipientId]);
  assert.equal(prepare.p_send_requested, true);
  const finish = s.calls.find(([name]) => name === 'uttu_teams_finish_delivery')[1];
  assert.equal(finish.p_status, 'sent'); assert.equal(finish.p_message_id, 'message');
  response = await s.route.POST(s.request());
  assert.equal(response.status, 200); assert.equal(s.sends(), 1);
});

test('a grant changed between load and claim cannot send or poison the newer grant', async () => {
  const s = scenario({ changedGrant: true });
  const response = await s.route.POST(s.request());
  assert.equal(response.status, 200); assert.equal(s.sends(), 0);
  const finish = s.calls.find(([name]) => name === 'uttu_teams_finish_delivery')[1];
  assert.equal(finish.p_status, 'skipped'); assert.equal(finish.p_error_code, 'connection_changed');
});

for (const [kind, options, patch, headers, http] of [
  ['no actor', { noUser: true }, {}, {}, 401],
  ['other author', { note: { user_id: recipientId } }, {}, {}, 403],
  ['body mismatch', {}, { expected_body: 'different' }, {}, 409],
  ['recipients mismatch', {}, { recipient_ids: [authorId] }, {}, 409],
  ['invalid ID', {}, { note_id: 'bad' }, {}, 400],
  ['cross origin', {}, {}, { Origin: 'https://evil.example' }, 403],
]) {
  test(`route rejects ${kind} without notification mutation or Graph`, async () => {
    const s = scenario(options); const response = await s.route.POST(s.request(patch, headers));
    assert.equal(response.status, http); assert.equal(s.sends(), 0); assert.equal(s.calls.length, 0);
  });
}

for (const [kind, options, patch] of [
  ['feature disabled', { disabled: true }, {}], ['author unchecked', {}, { send_teams: false }],
  ['stale submission', { note: { created_at: new Date(Date.now() - 3600_000).toISOString() } }, {}],
]) {
  test(`${kind} still creates in-app notification but never sends Teams`, async () => {
    const s = scenario(options); const response = await s.route.POST(s.request(patch));
    assert.equal(response.status, 200); assert.equal(s.sends(), 0);
    assert.equal(s.calls[0][1].p_send_requested, false);
  });
}

test('missing grant is recorded as reconnect-required and never bot fallback', async () => {
  const s = scenario({ noGrant: true });
  assert.equal((await s.route.POST(s.request())).status, 200);
  assert.equal(s.sends(), 0);
  assert.equal(s.calls.find(([name]) => name === 'uttu_teams_finish_delivery')[1].p_status, 'reconnect_required');
});

test('send-boundary rejection never overwrites SQL skipped state as sent', async () => {
  const s = scenario({ boundaryRejected: true });
  assert.equal((await s.route.POST(s.request())).status, 200);
  assert.equal(s.calls.filter(([name]) => name === 'uttu_teams_finish_delivery').length, 0);
});

test('unknown Graph result remains unknown with no automatic retry', async () => {
  const s = scenario({ outcome: { status: 'unknown', phase: 'message' } });
  const body = await (await s.route.POST(s.request())).json();
  assert.equal(body.unknown, 1); assert.equal(body.sent, 0);
  assert.equal(s.calls.find(([name]) => name === 'uttu_teams_finish_delivery')[1].p_status, 'unknown');
  await s.route.POST(s.request()); assert.equal(s.sends(), 1);
});

test('failure to persist a Graph success returns uncertainty and does not retry Graph', async () => {
  const s = scenario({ rpc: name => name === 'uttu_teams_finish_delivery' ? { error: { message: 'private database failure' } } : null });
  const response = await s.route.POST(s.request());
  assert.equal(response.status, 503); assert.equal(s.sends(), 1);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private database failure/);
});


for (const disabled of [true, false]) {
  test(`legacy note-only request remains in-app-only when Teams is ${disabled ? 'off' : 'on'}`, async () => {
    const s = scenario({ disabled });
    const request = new NextRequest(origin + '/api/me/notes/notify-mentions', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_id: noteId }),
    });
    const response = await s.route.POST(request);
    assert.equal(response.status, 200);
    assert.equal(s.sends(), 0);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0][0], 'uttu_teams_prepare_mentions');
    assert.equal(s.calls[0][1].p_send_requested, false);
    assert.equal(s.calls[0][1].p_expected_body, '@사람 메모');
    assert.deepEqual(s.calls[0][1].p_expected_recipient_ids, [recipientId]);
  });
}

for (const fields of [{ send_teams: true }, { send_teams: false }, { recipient_ids: [recipientId] }, { expected_body: '@사람 메모' }, { unexpected: true }]) {
  test(`partial or extended legacy shape cannot bypass reviewed submission: ${Object.keys(fields)[0]}=${JSON.stringify(Object.values(fields)[0])}`, async () => {
    const s = scenario();
    const request = new NextRequest(origin + '/api/me/notes/notify-mentions', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_id: noteId, ...fields }),
    });
    const response = await s.route.POST(request);
    assert.equal(response.status, 400);
    assert.equal(s.sends(), 0);
    assert.equal(s.calls.length, 0);
  });
}

for (const [kind, options, expected] of [['signed out', { noUser: true }, 401], ['other owner', { note: { user_id: recipientId } }, 403]]) {
  test(`legacy shape still rejects ${kind}`, async () => {
    const s = scenario(options);
    const request = new NextRequest(origin + '/api/me/notes/notify-mentions', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_id: noteId }),
    });
    assert.equal((await s.route.POST(request)).status, expected);
    assert.equal(s.sends(), 0);
    assert.equal(s.calls.length, 0);
  });
}

for (const [kind, id, requestOrigin, expected] of [
  ['malformed note UUID', 'not-a-uuid', origin, 400],
  ['cross-origin request', noteId, 'https://evil.example', 403],
]) {
  test(`legacy shape rejects ${kind}`, async () => {
    const s = scenario();
    const request = new NextRequest(origin + '/api/me/notes/notify-mentions', {
      method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_id: id }),
    });
    assert.equal((await s.route.POST(request)).status, expected);
    assert.equal(s.sends(), 0);
    assert.equal(s.calls.length, 0);
  });
}
