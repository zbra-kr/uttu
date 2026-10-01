const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const { NextRequest } = require('next/server');
const access = load('src/lib/teams/setup-access.ts');
const vault = load('src/lib/teams/vault.ts');
const config = load('src/lib/teams/config.ts');
const uid = '11111111-1111-4111-8111-111111111111';
const oid = '22222222-2222-4222-8222-222222222222';
const epoch = '33333333-3333-4333-8333-333333333333';
const fakeKey = Buffer.alloc(32, 7).toString('base64');
const identity = { userId: uid, tenantId: access.SETUP_TENANT, objectId: oid };
const user = { id: uid, identities: [{ provider: 'azure', identity_data: {
  iss: `https://login.microsoftonline.com/${access.SETUP_TENANT}/v2.0`,
  custom_claims: { oid, tid: access.SETUP_TENANT },
} }] };
const origin = 'https://uttu.example.test';
const environment = { TEAMS_CONNECTION_REQUIRED: 'true', TEAMS_MENTIONS_ENABLED: 'true',
  NEXT_PUBLIC_APP_URL: origin, TEAMS_MICROSOFT_CLIENT_SECRET: 'synthetic-client-value',
  TEAMS_TOKEN_ENCRYPTION_KEY: fakeKey };
async function env(values, fn) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try { for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : process.env[key] = value; return await fn(); }
  finally { for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value; }
}
function saved(patch = {}) {
  const bundle = { identity, consented: true, consentEpoch: epoch, accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh', scopes: ['Chat.Create', 'ChatMessage.Send'], expiresAt: Date.now() + 60_000, ...patch };
  return { user_id: uid, tenant_id: identity.tenantId, object_id: oid, consent_epoch: epoch, version: epoch,
    token_ciphertext: vault.encryptTeamsValue(bundle, fakeKey, `tokens:${uid}:${identity.tenantId}:${oid}:${epoch}`) };
}
test('Edge-compatible setup verifier authenticates the actual Node vault format', async () => {
  assert.equal(access.SETUP_TENANT, config.COMPANY_TENANT); assert.equal(access.SETUP_CLIENT, config.MICROSOFT_CLIENT);
  assert.equal(await access.verifyTeamsSetupConnection(saved(), identity, fakeKey), true);
  assert.equal(await access.verifyTeamsSetupConnection(saved({ expiresAt: Date.now() - 86_400_000 }), identity, fakeKey), true);
});
test('setup accepts every equivalent key encoding already accepted by existing Teams configuration', async () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const alternate = [...alphabet].map(char => fakeKey.slice(0, -2) + char + '=')
    .find(value => value !== fakeKey && Buffer.from(value, 'base64').equals(Buffer.from(fakeKey, 'base64')));
  assert(alternate);
  await env({ ...environment, TEAMS_TOKEN_ENCRYPTION_KEY: alternate }, async () => {
    assert(config.teamsConfig()); assert.equal(access.teamsSetupConfigurationAvailable(), true);
    assert.equal(await access.verifyTeamsSetupConnection(saved(), identity, alternate), true);
  });
});
for (const patch of [{ consented: false }, { refreshToken: '' }, { accessToken: '' },
  { scopes: ['Chat.Create'] }, { identity: { ...identity, objectId: uid } }, { consentEpoch: uid }, { expiresAt: 'tomorrow' }]) {
  test(`server-encrypted malformed bundle still fails setup: ${Object.keys(patch)[0]}`, async () =>
    assert.equal(await access.verifyTeamsSetupConnection(saved(patch), identity, fakeKey), false));
}
test('forged ciphertext, wrong key, actor or epoch cannot fabricate completed setup', async () => {
  const row = saved();
  for (const bad of [null, [], { ...row, token_ciphertext: 'v1.fake.fake.fake' },
    { ...row, user_id: oid }, { ...row, consent_epoch: uid }, { ...row, token_ciphertext: row.token_ciphertext + 'a' }]) {
    assert.equal(await access.verifyTeamsSetupConnection(bad, identity, fakeKey), false);
  }
  assert.equal(await access.verifyTeamsSetupConnection(row, identity, Buffer.alloc(32, 8).toString('base64')), false);
});
test('noncanonical equivalent base64 cannot change the sealed-grant fingerprint', async () => {
  const row = saved(), parts = row.token_ciphertext.split('.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const original = parts[2];
  const alternate = [...alphabet].map(char => original.slice(0, -1) + char)
    .find(value => value !== original && Buffer.from(value, 'base64url').equals(Buffer.from(original, 'base64url')));
  assert(alternate); parts[2] = alternate;
  assert.equal(await access.verifyTeamsSetupConnection({ ...row, token_ciphertext: parts.join('.') }, identity, fakeKey), false);
});
function client(options = {}) {
  const calls = [];
  return { calls,
    from: table => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
      calls.push(table); return { data: options.noProfile ? null : { role: options.role || 'viewer' }, error: options.profileError || null };
    } }) }) }),
    rpc: async name => { calls.push(name);
      if (options.rpcThrow) throw new Error('synthetic unavailable');
      if (name === 'uttu_teams_setup_status') return { data: { status: options.status || 'connected', connection_version: epoch }, error: options.rpcError || null };
      assert.equal(name, 'uttu_teams_get_connection');
      return { data: options.rows || [saved()], error: null };
    },
  };
}
test('verified admin survives missing Teams configuration and RPC failure', async () => env({ ...environment, TEAMS_TOKEN_ENCRYPTION_KEY: undefined }, async () => {
  const sb = client({ role: 'admin', rpcThrow: true });
  assert.equal((await access.readTeamsSetupAccess(sb, user)).decision.reason, 'admin_exempt');
  assert.deepEqual(sb.calls, ['profiles']);
}));
test('disabled rollout performs no new DB checks', async () => env({ TEAMS_CONNECTION_REQUIRED: undefined }, async () => {
  assert.deepEqual(await access.readTeamsSetupAccess({}, user), { decision: { allowed: true, reason: 'disabled' }, canConnect: false });
}));
test('metadata plus genuine sealed grant admits the current verified actor', async () => env(environment, async () => {
  assert.equal((await access.readTeamsSetupAccess(client(), user)).decision.allowed, true);
}));
for (const [label, options, reason] of [
  ['fabricated metadata', { rows: [{ ...saved(), token_ciphertext: 'fake-sealed-value' }] }, 'reconnect_required'],
  ['missing profile', { noProfile: true }, 'unavailable'],
  ['profile unavailable', { profileError: {} }, 'unavailable'],
  ['RPC unavailable', { rpcError: {} }, 'unavailable'],
  ['known revoked grant', { status: 'reconnect_required' }, 'reconnect_required'],
  ['connection removed', { rows: [] }, 'reconnect_required'],
  ['connection swapped after metadata read', { rows: [{ ...saved(), version: oid }] }, 'reconnect_required'],
]) test(`mandatory gate fails closed for ${label}`, async () => env(environment, async () => {
  const result = await access.readTeamsSetupAccess(client(options), user);
  assert.equal(result.decision.allowed, false); assert.equal(result.decision.reason, reason);
}));
test('user_metadata admin cannot bypass protected role or missing Microsoft identity', async () => env(environment, async () => {
  const actor = { id: uid, user_metadata: { role: 'admin' } };
  assert.equal((await access.readTeamsSetupAccess(client(), actor)).decision.reason, 'identity_required');
}));
function middleware(allowed = false, options = {}) {
  let checks = 0;
  const api = load('src/middleware.ts', {
    '@supabase/ssr': { createServerClient: (_url, _key, cookies) => ({ auth: { getUser: async () => {
      if (options.refresh) cookies.cookies.setAll([{ name: 'synthetic-session', value: 'fresh', options: { path: '/', httpOnly: true } }]);
      return { data: { user: options.noUser ? null : user } };
    } } }) },
    '@/lib/teams/setup-access': { teamsSetupRequired: () => options.enabled !== false,
      readTeamsSetupAccess: async () => { checks++; if (options.error) throw new Error(); return { decision: { allowed } }; } },
  });
  return { ...api, checks: () => checks };
}
test('web deep link is redirected to setup with its safe destination and refreshed session', async () => {
  const m = middleware(false, { refresh: true });
  const r = await m.middleware(new NextRequest(origin + '/ranking?brand=1'));
  const target = new URL(r.headers.get('location'));
  assert.equal(target.pathname, '/setup/teams'); assert.equal(target.searchParams.get('next'), '/ranking?brand=1');
  assert.equal(r.cookies.get('synthetic-session').value, 'fresh'); assert.equal(m.checks(), 1);
});
test('protected app API returns a machine-readable setup requirement without executing its route', async () => {
  const r = await middleware().middleware(new NextRequest(origin + '/api/me/notes/notify-mentions', { method: 'POST' }));
  assert.equal(r.status, 428); const body = await r.json(); assert.equal(body.error, 'teams_setup_required');
  assert.equal(new URL(body.setup_url, origin).searchParams.get('next'), '/');
});
for (const path of ['/setup/teams?attempted=1', '/api/me/teams/connection', '/api/auth/local-signout',
  '/auth/callback', '/auth/teams/callback', '/reset-password', '/api/mcp', '/api/stats', '/admin-login']) {
  test(`setup/recovery/existing public surface remains reachable: ${path}`, async () => {
    const m = middleware(); const r = await m.middleware(new NextRequest(origin + path));
    assert.equal(r.status, 200); assert.equal(m.checks(), 0);
  });
}
test('connected/admin decision allows app; provider/RPC error does not bypass it', async () => {
  assert.equal((await middleware(true).middleware(new NextRequest(origin + '/'))).status, 200);
  assert.equal((await middleware(false, { error: true }).middleware(new NextRequest(origin + '/'))).status, 307);
});
test('local logout remains reachable after session expiry and revokes only local session', async () => {
  assert.equal((await middleware(false, { noUser: true }).middleware(new NextRequest(origin + '/api/auth/local-signout', { method: 'POST' }))).status, 200);
  await env({ NEXT_PUBLIC_APP_URL: origin }, async () => {
    let scope;
    const route = load('src/app/api/auth/local-signout/route.ts', {
      '@/lib/supabase/server': { supabaseServer: async () => ({ auth: { signOut: async arg => { scope = arg.scope; return { error: null }; } } }) },
    });
    const request = givenOrigin => new NextRequest(origin + '/api/auth/local-signout', {
      method: 'POST', headers: { Origin: givenOrigin, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal((await route.POST(request('https://evil.example'))).status, 403); assert.equal(scope, undefined);
    assert.deepEqual(await (await route.POST(request(origin))).json(), { url: '/login' }); assert.equal(scope, 'local');
  });
});
