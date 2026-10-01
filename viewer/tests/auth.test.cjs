const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const loadSource = require('./helpers/load-source.cjs');

const oauth = loadSource('src/lib/auth/oauth.ts');
const microsoftProfile = loadSource('src/lib/auth/microsoft-profile.ts');

for (const value of ['/', '/today', '/market?brand=a&date=2026-10-01', '/reset-password', '/me#settings']) {
  test(`same-origin redirect preserved: ${value}`, () => {
    assert.equal(oauth.safeAuthRedirect(value), value);
  });
}

for (const value of [
  undefined, null, [], 'https://evil.example', '//evil.example', 'javascript:alert(1)',
  '/\\evil.example', '/\tevil.example', '/\nevil.example', ' /today',
  '/%2fevil.example', '/%5cevil.example', '/.//evil.example', '/%2e%2e//evil.example',
  '/a/..//evil.example', '/login', '/auth/callback?code=stale',
]) {
  test(`unsafe or looping redirect rejected: ${JSON.stringify(value)}`, () => {
    assert.equal(oauth.safeAuthRedirect(value), '/');
  });
}

test('Azure requests basic email/profile claims, PKCE callback and no forced prompt or Graph scopes', () => {
  const credentials = oauth.microsoftOAuthCredentials('https://uttu.bcave.ai', '/market?q=a&b=2', true);
  assert.deepEqual(credentials, {
    provider: 'azure',
    options: {
      scopes: 'email profile',
      redirectTo: 'https://uttu.bcave.ai/auth/callback?next=%2Fmarket%3Fq%3Da%26b%3D2',
      skipBrowserRedirect: true,
    },
  });
});

test('default callback has no unnecessary next query and local dev uses port 3100', () => {
  assert.equal(oauth.microsoftOAuthCredentials('http://localhost:3100', null, false).options.redirectTo,
    'http://localhost:3100/auth/callback');
});

for (const origin of ['', 'not-a-url', 'http://uttu.bcave.ai', 'javascript:alert(1)',
  'https://user:password@uttu.bcave.ai', 'https://uttu.bcave.ai/path',
  'https://uttu.bcave.ai/?redirect=evil', 'https://uttu.bcave.ai/#fragment']) {
  test(`invalid production app origin rejected: ${origin}`, () => {
    assert.throws(() => oauth.microsoftOAuthCredentials(origin, '/', true));
  });
}

test('only fixed error messages are reflected', () => {
  assert.match(oauth.authErrorMessage('cancelled'), /취소/);
  assert.match(oauth.authErrorMessage('auth'), /완료하지/);
  assert.equal(oauth.authErrorMessage('<script>provider-token</script>'), undefined);
});

function microsoftAction(signInWithOAuth) {
  return loadSource('src/app/auth/microsoft.ts', {
    '@/lib/auth/oauth': oauth,
    '@/lib/supabase/server': { supabaseServer: async () => ({ auth: { signInWithOAuth } }) },
    'next/navigation': { redirect: (url) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url }); } },
  }).signInWithMicrosoft;
}

async function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const configuredEnv = {
  NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED: 'true',
  NEXT_PUBLIC_APP_URL: 'https://uttu.bcave.ai',
  NEXT_PUBLIC_SITE_URL: undefined,
  NODE_ENV: 'production',
};

test('disabled Microsoft server action never calls Supabase', async () => {
  await withEnv({ ...configuredEnv, NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED: undefined }, async () => {
    const action = microsoftAction(() => assert.fail('Disabled OAuth must not run'));
    assert.match((await action(null, new FormData())).error, /아직 설정/);
  });
});

test('missing production URL fails closed before contacting Supabase', async () => {
  await withEnv({ ...configuredEnv, NEXT_PUBLIC_APP_URL: undefined }, async () => {
    const action = microsoftAction(() => assert.fail('Missing configuration must not run'));
    assert.match((await action(null, new FormData())).error, /주소/);
  });
});

test('server action delegates to Supabase and does not catch Next redirect', async () => {
  await withEnv(configuredEnv, async () => {
    const form = new FormData();
    form.set('next', '/today?team=finance');
    let calls = 0;
    const action = microsoftAction(async (credentials) => {
      calls += 1;
      assert.equal(credentials.provider, 'azure');
      assert.equal(new URL(credentials.options.redirectTo).searchParams.get('next'), '/today?team=finance');
      return { data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=azure' }, error: null };
    });
    await assert.rejects(action(null, form), (err) => err.message === 'NEXT_REDIRECT' && err.url.includes('provider=azure'));
    assert.equal(calls, 1);
  });
});

test('SITE_URL fallback works and unsafe next cannot leave UTTU', async () => {
  await withEnv({ ...configuredEnv, NEXT_PUBLIC_APP_URL: undefined, NEXT_PUBLIC_SITE_URL: 'https://uttu.bcave.ai' }, async () => {
    const form = new FormData();
    form.set('next', '//evil.example');
    const action = microsoftAction(async ({ options }) => {
      assert.equal(options.redirectTo, 'https://uttu.bcave.ai/auth/callback');
      return { data: { url: null }, error: null };
    });
    assert.match((await action(null, form)).error, /연결하지/);
  });
});

for (const failure of ['error', 'missing-url', 'network']) {
  test(`OAuth initiation ${failure} is recoverable without exposing details`, async () => {
    await withEnv(configuredEnv, async () => {
      const action = microsoftAction(async () => {
        if (failure === 'network') throw new Error('private-provider-detail');
        return { data: { url: null }, error: failure === 'error' ? { message: 'private-provider-detail' } : null };
      });
      const result = await action(null, new FormData());
      assert.match(result.error, /연결하지/);
      assert.doesNotMatch(result.error, /private-provider-detail/);
    });
  });
}

function callback(exchangeCodeForSession) {
  return loadSource('src/app/auth/callback/route.ts', {
    '@/lib/auth/oauth': oauth,
    '@/lib/auth/microsoft-profile': microsoftProfile,
    '@/lib/supabase/server': { supabaseServer: async () => ({ auth: { exchangeCodeForSession } }) },
    'next/server': { NextResponse: { redirect: (url) => new URL(url) } },
  }).GET;
}

test('callback exchanges the code once and preserves deep-link query', async () => {
  let calls = 0;
  const get = callback(async (code) => { calls += 1; assert.equal(code, 'pkce-code'); return { error: null }; });
  const result = await get({ url: 'https://uttu.bcave.ai/auth/callback?code=pkce-code&next=%2Fmarket%3Fteam%3Dfinance' });
  assert.equal(result.href, 'https://uttu.bcave.ai/market?team=finance');
  assert.equal(calls, 1);
});

test('callback neutralizes a protocol-relative redirect after path normalization', async () => {
  const get = callback(async () => ({ error: null }));
  const result = await get({ url: 'https://uttu.bcave.ai/auth/callback?code=pkce-code&next=%2F.%2F%2Fevil.example' });
  assert.equal(result.href, 'https://uttu.bcave.ai/');
});

test('existing password-recovery callback destination is preserved', async () => {
  const get = callback(async () => ({ error: null }));
  const result = await get({ url: 'https://uttu.bcave.ai/auth/callback?code=recovery-code&next=/reset-password' });
  assert.equal(result.pathname, '/reset-password');
});

test('mandatory setup follows successful sign-in and preserves the safe query and fragment', async () => {
  await withEnv({ TEAMS_CONNECTION_REQUIRED: 'true' }, async () => {
    const get = callback(async () => ({ error: null }));
    const result = await get({ url: 'https://uttu.bcave.ai/auth/callback?code=synthetic&next=%2Fmarket%3Fbrand%3Da%23chart' });
    assert.equal(result.pathname, '/setup/teams');
    assert.equal(result.searchParams.get('next'), '/market?brand=a#chart');
  });
});

test('mandatory Teams setup does not interrupt password recovery', async () => {
  await withEnv({ TEAMS_CONNECTION_REQUIRED: 'true' }, async () => {
    const result = await callback(async () => ({ error: null }))({ url: 'https://uttu.bcave.ai/auth/callback?code=synthetic&next=/reset-password' });
    assert.equal(result.pathname, '/reset-password');
  });
});

for (const query of ['', '?error=access_denied&error_description=private-provider-detail&code=unused', '?error=server_error']) {
  test(`missing code or provider error skips exchange: ${query}`, async () => {
    const get = callback(() => assert.fail('Must not exchange a failed callback'));
    const result = await get({ url: `https://uttu.bcave.ai/auth/callback${query}` });
    assert.equal(result.pathname, '/login');
    assert.equal(result.searchParams.get('error'), query.includes('access_denied') ? 'cancelled' : 'auth');
    assert.doesNotMatch(result.href, /private-provider-detail|unused/);
  });
}

for (const network of [false, true]) {
  test(`expired/repeated code or network error returns to login (network=${network})`, async () => {
    const get = callback(async () => {
      if (network) throw new Error('private-provider-detail');
      return { error: { message: 'expired or already exchanged' } };
    });
    const result = await get({ url: 'https://uttu.bcave.ai/auth/callback?code=stale&next=%2Ftoday%3Fteam%3Dfinance' });
    assert.equal(result.pathname, '/login');
    assert.equal(result.searchParams.get('error'), 'auth');
    assert.equal(result.searchParams.get('redirect'), '/today?team=finance');
    assert.doesNotMatch(result.href, /stale|private-provider-detail/);
  });
}

for (const [enabled, pending] of [[false, false], [true, false], [true, true]]) {
  test(`shared desktop/mobile button renders correctly (enabled=${enabled}, pending=${pending})`, async () => {
    await withEnv({ NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED: enabled ? 'true' : undefined }, async () => {
      const React = require('react');
      const { renderToStaticMarkup } = require('react-dom/server');
      const MicrosoftLogin = loadSource('src/app/login/MicrosoftLogin.tsx', {
        '../auth/microsoft': { signInWithMicrosoft: () => {} },
        'react-dom': {
          useFormState: () => [null, '/test-action'],
          useFormStatus: () => ({ pending }),
        },
      }).default;
      const html = renderToStaticMarkup(React.createElement(MicrosoftLogin, { next: '/today?team=finance' }));
      if (!enabled) {
        assert.equal(html, '');
        return;
      }
      assert.match(html, /name="next" value="\/today\?team=finance"/);
      assert(html.includes(pending ? 'Microsoft로 이동 중…' : '회사 Microsoft 계정으로 로그인'));
      assert.equal(html.includes('disabled=""'), pending);
      assert(html.includes(`aria-busy="${pending}"`));
    });
  });
}

function azureUser(identityData = { full_name: '  Entra Display Name  ' }) {
  return { id: 'verified-user-id', identities: [{ provider: 'azure', identity_data: identityData }] };
}

test('Microsoft name uses Azure identity display claims only', () => {
  assert.equal(microsoftProfile.microsoftDisplayName(azureUser()), 'EntraDisplayName');
  assert.equal(microsoftProfile.microsoftDisplayName(azureUser({ full_name: '  ', name: 'Fallback Name' })), 'FallbackName');
  assert.equal(microsoftProfile.microsoftDisplayName(azureUser({ full_name: 123, name: null })), undefined);
  assert.equal(microsoftProfile.microsoftDisplayName({ id: 'u', email: 'invented@example.com', user_metadata: { full_name: 'User supplied' }, identities: [{ provider: 'email', identity_data: { full_name: 'Other Provider' } }] }), undefined);
  assert.equal(microsoftProfile.microsoftDisplayName(null), undefined);
});

// Unicode White_Space plus ECMAScript's BOM; all are removed everywhere.
for (const whitespace of [
  '\t', '\n', '\v', '\f', '\r', ' ', '\u0085', '\u00a0', '\u1680',
  '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006',
  '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f',
  '\u205f', '\u3000', '\ufeff',
]) {
  test(`Azure imported names remove Unicode whitespace U+${whitespace.charCodeAt(0).toString(16)}`, () => {
    assert.equal(microsoftProfile.microsoftDisplayName(azureUser({ full_name: `${whitespace}정${whitespace}호${whitespace}철${whitespace}` })), '정호철');
    assert.equal(microsoftProfile.microsoftDisplayName(azureUser({ full_name: whitespace, name: '정 호철' })), '정호철');
    assert.equal(microsoftProfile.microsoftDisplayName(azureUser({ full_name: whitespace, name: whitespace })), undefined);
  });
}

test('Name normalization preserves spelling, punctuation and meaningful joiners', () => {
  assert.equal(microsoftProfile.microsoftDisplayName(azureUser({ full_name: " Anne-Marie O’Neill " })), 'Anne-MarieO’Neill');
  assert.equal(microsoftProfile.microsoftDisplayName(azureUser({ full_name: 'A\u200cB\u200dC' })), 'A\u200cB\u200dC');
});

function profileClient(previousName, options = {}) {
  const calls = [];
  const client = { from(table) {
    assert.equal(table, 'profiles');
    return {
      select(columns) {
        assert.equal(columns, 'full_name');
        return { eq(column, id) {
          calls.push(['read', column, id]);
          return { async maybeSingle() {
            if (options.throwRead) throw new Error('private database details');
            return { data: options.missing ? null : { full_name: previousName }, error: options.readError ? { message: 'private details' } : null };
          } };
        } };
      },
      update(patch) {
        calls.push(['update', patch]);
        const query = {
          eq(column, value) { calls.push(['eq', column, value]); return query; },
          is(column, value) { calls.push(['is', column, value]); return query; },
          then(resolve, reject) { return Promise.resolve({ error: options.writeError ? { message: 'private details' } : null }).then(resolve, reject); },
        };
        return query;
      },
    };
  } };
  return { client, calls };
}

for (const previousName of [null, '', '   ', '\u0085\u00a0\u3000\ufeff', ' Entra Display Name ', 'Entra\tDisplay\u3000Name']) {
  test(`Azure login fills blank or normalizes imported name with exact-value race protection: ${JSON.stringify(previousName)}`, async () => {
    const { client, calls } = profileClient(previousName);
    assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, azureUser()), 'updated');
    assert.deepEqual(calls, [
      ['read', 'id', 'verified-user-id'],
      ['update', { full_name: 'EntraDisplayName' }],
      ['eq', 'id', 'verified-user-id'],
      [previousName === null ? 'is' : 'eq', 'full_name', previousName],
    ]);
  });
}

test('Azure name sync preserves existing custom names and unrelated fields', async () => {
  const { client, calls } = profileClient('My chosen name');
  assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, azureUser()), 'skipped');
  assert.deepEqual(calls, [['read', 'id', 'verified-user-id']]);
});

test('Already-normalized imported name is idempotent', async () => {
  const { client, calls } = profileClient('EntraDisplayName');
  assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, azureUser()), 'skipped');
  assert.deepEqual(calls, [['read', 'id', 'verified-user-id']]);
});

test('New-signup DB name is normalized before the callback redirects', async () => {
  const user = azureUser({ full_name: '정 호철' });
  const { client, calls } = profileClient('정 호철');
  client.auth = { exchangeCodeForSession: async () => ({ data: { user }, error: null }) };
  const get = loadSource('src/app/auth/callback/route.ts', {
    '@/lib/auth/oauth': oauth,
    '@/lib/auth/microsoft-profile': microsoftProfile,
    '@/lib/supabase/server': { supabaseServer: async () => client },
    'next/server': { NextResponse: { redirect: (url) => new URL(url) } },
  }).GET;
  assert.equal((await get({ url: 'https://uttu.bcave.ai/auth/callback?code=code&next=/today' })).href, 'https://uttu.bcave.ai/today');
  assert.deepEqual(calls, [
    ['read', 'id', 'verified-user-id'],
    ['update', { full_name: '정호철' }],
    ['eq', 'id', 'verified-user-id'],
    ['eq', 'full_name', '정 호철'],
  ]);
});

test('Auth display metadata normalizes only matching names, preserving provider identity and all unrelated keys', async () => {
  const user = {
    ...azureUser({ full_name: '정 호철', name: '정 호철' }),
    user_metadata: { full_name: '정 호철', name: '정\u3000호철', role: 'admin', theme: 'dark' },
    app_metadata: { provider: 'azure', providers: ['azure'] },
  };
  const before = structuredClone(user);
  const { client, calls } = profileClient('정 호철');
  const authCalls = [];
  client.auth = { updateUser: async attributes => { authCalls.push(attributes); return { error: null }; } };
  assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, user), 'updated');
  assert.deepEqual(authCalls, [{ data: { full_name: '정호철', name: '정호철' } }]);
  assert.deepEqual(calls.find(call => call[0] === 'update'), ['update', { full_name: '정호철' }]);
  assert.deepEqual(user, before);
});

test('Auth metadata custom names, normalized names and non-name fields are never overwritten', async () => {
  const user = { ...azureUser(), user_metadata: { full_name: 'My custom name', name: 'EntraDisplayName', preferred_username: 'keep name', role: 'admin' } };
  const { client, calls } = profileClient('My chosen name');
  client.auth = { updateUser: () => assert.fail('Must preserve Auth custom metadata') };
  assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, user), 'skipped');
  assert.deepEqual(calls, [['read', 'id', 'verified-user-id']]);
});

test('Auth names still normalize when the app has a distinct custom name', async () => {
  const user = { ...azureUser(), user_metadata: { full_name: 'Entra Display Name' } };
  const { client, calls } = profileClient('My chosen name');
  client.auth = { updateUser: async attributes => {
    assert.deepEqual(attributes, { data: { full_name: 'EntraDisplayName' } });
    return { error: null };
  } };
  assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, user), 'updated');
  assert.deepEqual(calls, [['read', 'id', 'verified-user-id']]);
});

for (const throws of [false, true]) {
  test(`Auth metadata normalization failure still updates app profile (throws=${throws})`, async () => {
    const user = { ...azureUser(), user_metadata: { full_name: 'Entra Display Name' } };
    const { client, calls } = profileClient('Entra Display Name');
    client.auth = { updateUser: async () => {
      if (throws) throw new Error('private network details');
      return { error: { message: 'private auth details' } };
    } };
    assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, user), 'failed');
    assert.deepEqual(calls.find(call => call[0] === 'update'), ['update', { full_name: 'EntraDisplayName' }]);
  });
}

test('App profile failure still attempts Auth name normalization', async () => {
  const user = { ...azureUser(), user_metadata: { full_name: 'Entra Display Name' } };
  const { client } = profileClient('Entra Display Name', { readError: true });
  let authUpdated = false;
  client.auth = { updateUser: async () => { authUpdated = true; return { error: null }; } };
  assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, user), 'failed');
  assert.equal(authUpdated, true);
});

for (const metadataError of [false, true]) {
  test(`Installed Auth/SSR SDK normalizes callback display metadata without changing identity or session (metadataError=${metadataError})`, async () => {
    const { createServerClient } = require('@supabase/ssr');
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const user = {
      ...azureUser({ full_name: '정 호철' }), aud: 'authenticated', created_at: '2026-01-01T00:00:00Z',
      email: 'existing@example.com', app_metadata: { provider: 'azure' },
      user_metadata: { full_name: '정 호철', name: '정 호철', theme: 'dark' },
    };
    const session = { access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', token_type: 'bearer', expires_at: expiry, expires_in: 3600, user };
    const cookieKey = 'sb-whitespace-auth-token';
    const jar = new Map([[cookieKey, 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')], ['foreign-cookie', 'unchanged']]);
    const calls = [];
    let metadataWrites = 0;
    const client = createServerClient('https://whitespace.supabase.co', 'public-placeholder-key', {
      cookies: {
        getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
        setAll: values => { for (const { name, value, options } of values) { if (options.maxAge === 0) jar.delete(name); else jar.set(name, value); } },
      },
      global: { fetch: async (input, options = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url || String(input));
        const method = options.method || 'GET';
        calls.push([method, url.pathname]);
        const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname === '/auth/v1/user' && method === 'PUT') {
          metadataWrites += 1;
          const body = JSON.parse(options.body);
          assert.deepEqual(body, { data: { full_name: '정호철', name: '정호철' }, code_challenge: null, code_challenge_method: null });
          if (metadataError) return json({ code: 'unexpected_failure', msg: 'offline failure' }, 400);
          return json({ ...user, user_metadata: { ...user.user_metadata, ...body.data } });
        }
        if (url.pathname === '/rest/v1/profiles') {
          assert.equal(url.searchParams.get('id'), 'eq.verified-user-id');
          if (method === 'GET') { assert.equal(url.searchParams.get('select'), 'full_name'); return json({ full_name: '정 호철' }); }
          assert.equal(method, 'PATCH');
          assert.equal(url.searchParams.get('full_name'), 'eq.정 호철');
          assert.deepEqual(JSON.parse(options.body), { full_name: '정호철' });
          return new Response(null, { status: 204 });
        }
        assert.fail(`Unexpected offline SDK request: ${method} ${url.pathname}`);
      } },
    });
    assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, user), metadataError ? 'failed' : 'updated');
    assert.equal(metadataWrites, 1);
    assert(calls.some(([method, pathname]) => method === 'PATCH' && pathname === '/rest/v1/profiles'));
    assert.equal(jar.get('foreign-cookie'), 'unchanged');
    const saved = JSON.parse(Buffer.from(jar.get(cookieKey).slice(7), 'base64url').toString());
    assert.equal(saved.access_token, session.access_token);
    assert.equal(saved.refresh_token, session.refresh_token);
    assert.equal(saved.user.id, user.id);
    assert.deepEqual(saved.user.identities, user.identities);
    assert.deepEqual(saved.user.app_metadata, user.app_metadata);
    assert.deepEqual(saved.user.user_metadata, metadataError ? user.user_metadata : { full_name: '정호철', name: '정호철', theme: 'dark' });
  });
}

test('Missing Azure name never guesses from email or mutates a profile', async () => {
  const { client, calls } = profileClient('');
  assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, azureUser({})), 'skipped');
  assert.deepEqual(calls, []);
});

for (const options of [{ missing: true }, { readError: true }, { throwRead: true }, { writeError: true }]) {
  test(`Name-sync errors are contained and cannot fail authentication: ${JSON.stringify(options)}`, async () => {
    const { client } = profileClient('', options);
    assert.equal(await microsoftProfile.syncMicrosoftProfileName(client, azureUser()), options.missing ? 'skipped' : 'failed');
  });
}

test('Successful callback syncs the authenticated user before redirect', async () => {
  const user = azureUser();
  let synced = false;
  const client = { auth: { exchangeCodeForSession: async () => ({ data: { user }, error: null }) } };
  const get = loadSource('src/app/auth/callback/route.ts', {
    '@/lib/auth/oauth': oauth,
    '@/lib/auth/microsoft-profile': { syncMicrosoftProfileName: async (receivedClient, receivedUser) => {
      assert.equal(receivedClient, client); assert.equal(receivedUser, user); synced = true; return 'updated';
    } },
    '@/lib/supabase/server': { supabaseServer: async () => client },
    'next/server': { NextResponse: { redirect: (url) => new URL(url) } },
  }).GET;
  assert.equal((await get({ url: 'https://uttu.bcave.ai/auth/callback?code=code&next=/today' })).href, 'https://uttu.bcave.ai/today');
  assert(synced);
});

test('Failed name backfill does not turn a successful login into auth failure', async () => {
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const get = loadSource('src/app/auth/callback/route.ts', {
      '@/lib/auth/oauth': oauth,
      '@/lib/auth/microsoft-profile': { syncMicrosoftProfileName: async () => 'failed' },
      '@/lib/supabase/server': { supabaseServer: async () => ({ auth: { exchangeCodeForSession: async () => ({ data: { user: azureUser() }, error: null }) } }) },
      'next/server': { NextResponse: { redirect: (url) => new URL(url) } },
    }).GET;
    assert.equal((await get({ url: 'https://uttu.bcave.ai/auth/callback?code=private-code' })).href, 'https://uttu.bcave.ai/');
    assert.deepEqual(warnings, ['[auth] Microsoft profile name sync failed']);
  } finally { console.warn = previousWarn; }
});
