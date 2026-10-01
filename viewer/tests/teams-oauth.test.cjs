const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const jose = require('jose');

function load(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
  });
  const mod = new Module(filename, module); mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = name => name === 'server-only' ? {} : Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  mod._compile(outputText, filename); return mod.exports;
}

const identities = load('src/lib/teams/identity.ts');
const configModule = load('src/lib/teams/config.ts', { './identity': identities });
const vault = load('src/lib/teams/vault.ts');
const graph = load('src/lib/teams/graph.ts', { './identity': identities });
// A deterministic, explicitly fake test key, never an application credential.
const fakeKey = Buffer.alloc(32, 7).toString('base64');
const config = {
  origin: 'https://uttu.example.test', tenantId: configModule.COMPANY_TENANT,
  clientId: configModule.MICROSOFT_CLIENT, clientSecret: 'mock-client-secret', encryptionKey: fakeKey,
  callback: 'https://uttu.example.test/auth/teams/callback', secure: true,
};
const uid = '11111111-1111-4111-8111-111111111111';
const oid = '22222222-2222-4222-8222-222222222222';
const principal = { userId: uid, objectId: oid, tenantId: config.tenantId };
const user = { id: uid, identities: [{ provider: 'azure', identity_data: {
  iss: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
  custom_claims: { oid, tid: config.tenantId },
} }] };

function oauth(joseOverride = jose) {
  return load('src/lib/teams/oauth.ts', {
    './config': configModule, './identity': identities, './vault': vault, './graph': graph, jose: joseOverride,
  });
}

test('AES-GCM envelope hides token, decrypts only for same user and purpose', () => {
  const clear = { refreshToken: 'fake-refresh-token', accessToken: 'fake-access-token' };
  const sealed = vault.encryptTeamsValue(clear, fakeKey, 'tokens:one');
  assert.doesNotMatch(sealed, /fake-refresh|fake-access/);
  assert.deepEqual(vault.decryptTeamsValue(sealed, fakeKey, 'tokens:one'), clear);
  assert.throws(() => vault.decryptTeamsValue(sealed, fakeKey, 'tokens:two'), /vault unavailable/);
  assert.throws(() => vault.decryptTeamsValue(sealed, Buffer.alloc(32, 8).toString('base64'), 'tokens:one'));
  const changed = sealed.slice(0, -4) + 'abcd';
  assert.throws(() => vault.decryptTeamsValue(changed, fakeKey, 'tokens:one'));
  assert.notEqual(vault.encryptTeamsValue(clear, fakeKey, 'tokens:one'), sealed);
});

for (const key of ['', 'short', Buffer.alloc(16).toString('base64'), 'x'.repeat(44)]) {
  test(`invalid encryption key rejected: length ${key.length}`, () => {
    assert.throws(() => vault.encryptTeamsValue({}, key, 'anything'));
  });
}

test('origin/JSON checks reject cross-site, missing origin and form CSRF', () => {
  const req = headers => new Request(config.origin, { method: 'POST', headers });
  assert.equal(configModule.isSameOriginPost(req({ origin: config.origin, 'content-type': 'application/json' }), config.origin), true);
  for (const headers of [
    { origin: 'https://evil.example', 'content-type': 'application/json' },
    { 'content-type': 'application/json' },
    { origin: config.origin, 'content-type': 'application/x-www-form-urlencoded' },
    { origin: config.origin, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
  ]) assert.equal(configModule.isSameOriginPost(req(headers), config.origin), false);
});

test('connect uses fixed app/tenant/redirect, PKCE, state, nonce and minimum delegated scopes', async () => {
  const api = oauth();
  const sb = { rpc: async (name, args) => {
    if (name === 'uttu_teams_get_connection_epoch') return { data: 'epoch-1' };
    assert.equal(name, 'uttu_teams_get_connection'); assert.equal(args.p_author_id, uid);
    return { data: [], error: null };
  } };
  const { url, cookie } = await api.beginTeamsConnect(sb, user, config);
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://login.microsoftonline.com');
  assert.equal(parsed.pathname, `/${config.tenantId}/oauth2/v2.0/authorize`);
  assert.equal(parsed.searchParams.get('redirect_uri'), config.callback);
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsed.searchParams.get('client_id'), config.clientId);
  assert.match(parsed.searchParams.get('scope'), /offline_access/);
  assert.doesNotMatch(parsed.searchParams.get('scope'), /Chat.ReadWrite|User.Read|\.All|client_credentials/);
  assert.doesNotMatch(url + cookie, /mock-client-secret/);
  const attempt = vault.decryptTeamsValue(cookie, fakeKey, 'oauth-attempt');
  assert.equal(attempt.state, parsed.searchParams.get('state'));
  assert.equal(attempt.nonce, parsed.searchParams.get('nonce'));
  assert.deepEqual(attempt.identity, principal);
  assert.ok(attempt.expiresAt > Date.now());
  assert.equal(attempt.previousVersion, null);
});

async function withFetch(fn, run) {
  const old = global.fetch;
  global.fetch = fn;
  try { return await run(); } finally { global.fetch = old; }
}

test('OAuth callback validates real signature/issuer/audience/nonce and stores ciphertext only', async () => {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey); jwk.kid = 'test';
  const api = oauth({ ...jose, createRemoteJWKSet: url => {
    assert.equal(url.toString(), `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`);
    return jose.createLocalJWKSet({ keys: [jwk] });
  } });
  let stored;
  const sb = { rpc: async (name, args) => {
    if (name === 'uttu_teams_get_connection_epoch') return { data: 'epoch-1' };
    if (name === 'uttu_teams_get_connection') return { data: [] };
    assert.equal(name, 'uttu_teams_put_connection'); stored = args;
    return { data: '33333333-3333-4333-8333-333333333333' };
  } };
  const start = await api.beginTeamsConnect(sb, user, config);
  const attempt = vault.decryptTeamsValue(start.cookie, fakeKey, 'oauth-attempt');
  const idToken = await new jose.SignJWT({ oid, tid: config.tenantId, nonce: attempt.nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(user.identities[0].identity_data.iss)
    .setAudience(config.clientId).setSubject('pairwise-sub').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  await withFetch(async (url, init) => {
    assert.equal(url, `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`);
    assert.equal(init.redirect, 'error');
    assert.equal(init.body.get('client_secret'), 'mock-client-secret');
    assert.equal(init.body.get('code_verifier'), attempt.verifier);
    return Response.json({ token_type: 'Bearer', access_token: 'fake-access', refresh_token: 'fake-refresh',
      expires_in: 3600, scope: 'Chat.Create ChatMessage.Send', id_token: idToken });
  }, () => api.completeTeamsConnect(sb, user, config, start.cookie, attempt.state, 'fake-code'));
  assert.doesNotMatch(JSON.stringify(stored), /fake-access|fake-refresh|mock-client-secret/);
  assert.deepEqual(stored.p_granted_scopes, ['Chat.Create', 'ChatMessage.Send']);
  const bundle = vault.decryptTeamsValue(stored.p_token_ciphertext, fakeKey, `tokens:${uid}:${config.tenantId}:${oid}:epoch-1`);
  assert.equal(bundle.accessToken, 'fake-access'); assert.equal(bundle.refreshToken, 'fake-refresh');
});

for (const kind of ['state', 'expired', 'different-user', 'tampered-cookie']) {
  test(`OAuth callback rejects ${kind} before token exchange`, async () => {
    const api = oauth(); const sb = { rpc: async name => ({ data: name === 'uttu_teams_get_connection_epoch' ? 'epoch-1' : [] }) };
    const start = await api.beginTeamsConnect(sb, user, config);
    const attempt = vault.decryptTeamsValue(start.cookie, fakeKey, 'oauth-attempt');
    let cookie = start.cookie; let state = attempt.state; let actor = user;
    if (kind === 'state') state = 'wrong-state';
    if (kind === 'expired') cookie = vault.encryptTeamsValue({ ...attempt, expiresAt: Date.now() - 1 }, fakeKey, 'oauth-attempt');
    if (kind === 'different-user') actor = { ...user, id: oid };
    if (kind === 'tampered-cookie') cookie = start.cookie.slice(0, -10) + 'tampered00';
    await withFetch(async () => assert.fail('No token exchange allowed'), async () => {
      await assert.rejects(api.completeTeamsConnect(sb, actor, config, cookie, state, 'fake-code'));
    });
  });
}

for (const kind of ['wrong-oid', 'wrong-tenant', 'wrong-nonce', 'missing-scope', 'missing-refresh']) {
  test(`OAuth callback rejects ${kind} without saving`, async () => {
    let payload;
    const api = oauth({ createRemoteJWKSet: () => ({}), jwtVerify: async () => ({ payload }) });
    const sb = { rpc: async name => { if (name === 'uttu_teams_get_connection_epoch') return { data: 'epoch-1' }; assert.equal(name, 'uttu_teams_get_connection'); return { data: [] }; } };
    const start = await api.beginTeamsConnect(sb, user, config);
    const attempt = vault.decryptTeamsValue(start.cookie, fakeKey, 'oauth-attempt');
    payload = { oid, tid: config.tenantId, nonce: attempt.nonce };
    if (kind === 'wrong-oid') payload.oid = uid;
    if (kind === 'wrong-tenant') payload.tid = uid;
    if (kind === 'wrong-nonce') payload.nonce = 'bad';
    await withFetch(async () => Response.json({
      token_type: 'Bearer', access_token: 'fake-access', refresh_token: kind === 'missing-refresh' ? undefined : 'fake-refresh',
      expires_in: 3600, scope: kind === 'missing-scope' ? 'Chat.Create' : 'Chat.Create ChatMessage.Send', id_token: 'fake-id-token',
    }), () => assert.rejects(api.completeTeamsConnect(sb, user, config, start.cookie, attempt.state, 'fake-code')));
  });
}

function expiredConnection() {
  return { user_id: uid, tenant_id: config.tenantId, object_id: oid,
    version: '33333333-3333-4333-8333-333333333333', consent_epoch: 'epoch-1',
    token_ciphertext: vault.encryptTeamsValue({ identity: principal, consented: true, consentEpoch: 'epoch-1',
      accessToken: 'old-access', refreshToken: 'old-refresh', scopes: ['Chat.Create', 'ChatMessage.Send'],
      expiresAt: Date.now() - 1 }, fakeKey, `tokens:${uid}:${config.tenantId}:${oid}:epoch-1`) };
}

test('refresh rotates encrypted bundle using CAS, without application permissions', async () => {
  const api = oauth(); const old = expiredConnection(); let saved;
  const sb = { rpc: async (name, args) => name === 'uttu_teams_get_connection'
    ? { data: [old] } : (saved = args, { data: '44444444-4444-4444-8444-444444444444' }) };
  const grant = await withFetch(async (_, init) => {
    assert.equal(init.body.get('grant_type'), 'refresh_token');
    assert.equal(init.body.get('refresh_token'), 'old-refresh');
    return Response.json({ token_type: 'Bearer', access_token: 'new-access', refresh_token: 'new-refresh',
      expires_in: 3600, scope: 'Chat.Create ChatMessage.Send' });
  }, () => api.getTeamsAuthorGrant(sb, user, config));
  assert.equal(grant.accessToken, 'new-access');
  assert.equal(saved.p_expected_version, old.version);
  assert.doesNotMatch(JSON.stringify(saved), /new-access|new-refresh|old-refresh/);
});

test('disconnect wins refresh race and old refresh never recreates a deleted connection', async () => {
  const api = oauth(); const old = expiredConnection(); let reads = 0; let writes = 0;
  const sb = { rpc: async name => {
    if (name === 'uttu_teams_get_connection') return { data: ++reads === 1 ? [old] : [] };
    writes++; return { data: null };
  } };
  const grant = await withFetch(async () => Response.json({ token_type: 'Bearer', access_token: 'new-access',
    refresh_token: 'new-refresh', expires_in: 3600, scope: 'Chat.Create ChatMessage.Send' }),
  () => api.getTeamsAuthorGrant(sb, user, config));
  assert.equal(grant, null); assert.equal(reads, 2); assert.equal(writes, 1);
});

test('invalid-grant response is sanitized and does not leak tokens or overwrite vault', async () => {
  const api = oauth(); const old = expiredConnection();
  const sb = { rpc: async name => { assert.equal(name, 'uttu_teams_get_connection'); return { data: [old] }; } };
  await withFetch(async () => Response.json({ error: 'invalid_grant', error_description: 'private details' }, { status: 400 }),
    () => assert.rejects(api.getTeamsAuthorGrant(sb, user, config), error => {
      assert.equal(error.message, 'Teams reconnect required'); return true;
    }));
});
