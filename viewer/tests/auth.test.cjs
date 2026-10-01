const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Compile the actual source with the repo's TypeScript dependency. This keeps
// tests compatible with CI's Node 20 without adding a runner or changing deps.
function loadSource(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  });
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name);
  mod._compile(outputText, filename);
  return mod.exports;
}

const oauth = loadSource('src/lib/auth/oauth.ts');

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

test('Azure requests email, PKCE callback and no forced prompt or Graph scopes', () => {
  const credentials = oauth.microsoftOAuthCredentials('https://uttu.bcave.ai', '/market?q=a&b=2', true);
  assert.deepEqual(credentials, {
    provider: 'azure',
    options: {
      scopes: 'email',
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
