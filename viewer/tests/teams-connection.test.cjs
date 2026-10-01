const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const { NextRequest } = require('next/server');
const identity = load('src/lib/teams/identity.ts');
const actualConfig = load('src/lib/teams/config.ts', { './identity': identity });
const origin = 'https://uttu.example.test';
const uid = '11111111-1111-4111-8111-111111111111';
process.env.NEXT_PUBLIC_APP_URL = origin;
function route(connected = true, options = {}) {
  const calls = [];
  return { calls, ...load('src/app/api/me/teams/connection/route.ts', {
    '@/lib/supabase/server': { supabaseServer: async () => ({
      auth: { getUser: async () => ({ data: { user: options.user || { id: uid } } }) },
      rpc: async (name, args) => { calls.push([name, args]); return { data: 0 }; },
    }) },
    '@/lib/teams/config': { ...actualConfig, teamsConfig: () => options.enabled ? { origin, tenantId: actualConfig.COMPANY_TENANT } : null },
    '@/lib/teams/identity': identity,
    '@/lib/teams/oauth': {
      getTeamsConnection: async () => connected ? { user_id: uid, object_id: options.savedObjectId || uid, tenant_id: actualConfig.COMPANY_TENANT, token_ciphertext: 'private-ciphertext' } : null,
      connectCookie: secure => secure ? '__Host-uttu-teams-connect' : 'uttu-teams-connect',
      beginTeamsConnect: async () => assert.fail('Must not begin disabled OAuth'),
    },
  }) };
}
const request = (action, requestOrigin = origin) => new NextRequest(origin + '/api/me/teams/connection', {
  method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
});
test('disabled-feature status exposes only safe own connection state for cleanup', async () => {
  const response = await route().GET();
  assert.deepEqual(await response.json(), { available: false, connected: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('disconnect works with feature disabled and missing encryption/client secrets', async () => {
  const api = route(); const response = await api.POST(request('disconnect'));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { connected: false, available: false });
  assert.deepEqual(api.calls, [['uttu_teams_disconnect', { p_author_id: uid }]]);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});
test('disabled feature cannot initiate OAuth', async () => {
  const api = route(); assert.equal((await api.POST(request('connect'))).status, 503);
  assert.equal(api.calls.length, 0);
});
test('disconnect still rejects cross-origin CSRF when feature disabled', async () => {
  const api = route(); assert.equal((await api.POST(request('disconnect', 'https://evil.example'))).status, 403);
  assert.equal(api.calls.length, 0);
});

const azureUser = { id: uid, identities: [{ provider: 'azure', identity_data: {
  iss: `https://login.microsoftonline.com/${actualConfig.COMPANY_TENANT}/v2.0`,
  custom_claims: { oid: uid, tid: actualConfig.COMPANY_TENANT },
} }] };
test('changed valid Microsoft identity disables sending but preserves cleanup status', async () => {
  const api = route(true, { enabled: true, user: azureUser, savedObjectId: '22222222-2222-4222-8222-222222222222' });
  assert.deepEqual(await (await api.GET()).json(), { available: false, connected: true });
  assert.deepEqual(await (await api.POST(request('disconnect'))).json(), { available: true, connected: false });
});
test('missing Azure identity keeps disconnect visible without enabling send', async () => {
  const api = route(true, { enabled: true });
  assert.deepEqual(await (await api.GET()).json(), { available: false, connected: true });
});
