const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const supabaseJS = require('@supabase/supabase-js');
const supabaseSSR = require('@supabase/ssr');

// Keep the installed Auth/SSR implementations intact; inject offline transport
// and mock only Next's request/response boundaries.
function loadSource(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
  });
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const requireActual = mod.require.bind(mod); mod.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : requireActual(name);
  mod._compile(outputText, filename); return mod.exports;
}
const oauth = loadSource('src/lib/auth/oauth.ts');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://review.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-placeholder-key';
process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED = 'true';

function jwt(exp) {
  return [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ exp, sub: 'new-admin' }), 'synthetic-signature']
    .map(part => Buffer.from(part).toString('base64url')).join('.');
}
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function fixture(mode) {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const admin = { id: 'new-admin', aud: 'authenticated', email: 'existing-admin@example.com', app_metadata: { provider: 'email' }, user_metadata: mode === 'large-success' ? { display: 'x'.repeat(8500) } : {}, identities: [], created_at: '2026-01-01T00:00:00Z' };
  const token = jwt(mode === 'expired-refresh-error' ? 1 : future);
  const initial = mode === 'large-success'
    ? [['sb-review-auth-token', 'old-unchunked-cookie'], ['foreign-cookie', 'unchanged']]
    : [['sb-review-auth-token.0', 'old-chunk0'], ['sb-review-auth-token.1', 'old-chunk1'], ['foreign-cookie', 'unchanged'], ['sb-review-auth-token.other', 'unrelated-suffix']];
  const jar = new Map(initial); const calls = []; let userCalls = 0; let profileCalls = 0; let liveReads = 0; let writes = 0;
  const transport = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input));
    const method = options.method || 'GET'; calls.push([method, url.pathname, url.searchParams.get('scope')]);
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      return json({ access_token: token, refresh_token: 'candidate-refresh', token_type: 'bearer', expires_in: 3600, expires_at: future, user: admin });
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      assert.equal(mode, 'expired-refresh-error'); return json({ error_code: 'refresh_token_not_found', msg: 'refresh token not found' }, 400);
    }
    if (url.pathname === '/auth/v1/user') {
      userCalls += 1;
      if (userCalls > 1 && mode === 'missing-session') return json({ error_code: 'session_not_found', msg: 'session not found' }, 403);
      return json(userCalls > 1 && mode === 'mismatched-user' ? { ...admin, id: 'unexpected-user' } : admin);
    }
    if (url.pathname === '/rest/v1/profiles') {
      profileCalls += 1; assert.equal(url.searchParams.get('id'), 'eq.new-admin'); assert.equal(url.searchParams.get('select'), 'role');
      return json({ role: profileCalls > 1 && mode === 'final-role-demotion' ? 'viewer' : 'admin' });
    }
    if (url.pathname === '/auth/v1/logout') { assert.equal(url.searchParams.get('scope'), 'local'); return new Response(null, { status: 204 }); }
    assert.fail(`Unexpected offline SDK request: ${method} ${url.pathname}`);
  };
  const actions = loadSource('src/app/auth/actions.ts', {
    '@supabase/supabase-js': { createClient: (url, key, options) => supabaseJS.createClient(url, key, { ...options, global: { fetch: transport } }) },
    '@supabase/ssr': { createServerClient: (url, key, options) => supabaseSSR.createServerClient(url, key, { ...options, global: { fetch: transport } }) },
    '@/lib/auth/oauth': oauth,
    '@/lib/supabase/server': { supabaseServer: async () => assert.fail('Strict login cannot use the current browser SSR client') },
    'next/headers': { cookies: async () => ({
      getAll: () => { liveReads += 1; return Array.from(jar, ([name, value]) => ({ name, value })); },
      set(name, value, options) {
        writes += 1;
        if (mode === 'partial-write-error' && writes === 2) throw new Error('offline cookie write failure');
        if (options.maxAge === 0) jar.delete(name); else jar.set(name, value);
      },
    }) },
    'next/cache': { revalidatePath: () => calls.push(['revalidate']) },
    'next/navigation': { redirect: (url) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url }); } },
  });
  const form = new FormData(); form.set('email', 'existing-admin@example.com'); form.set('password', 'existing-password'); form.set('next', '/today?team=finance');
  return { run: () => actions.signInAdmin(null, form), jar, initial, calls, counts: () => ({ liveReads, writes, userCalls, profileCalls }) };
}
for (const mode of ['missing-session', 'expired-refresh-error', 'mismatched-user', 'final-role-demotion']) {
  test(`installed SSR ${mode} cannot read or change an existing browser session`, async () => {
    const fixtureRun = fixture(mode); const result = await fixtureRun.run();
    assert.match(result.error, /관리자 계정/); assert.deepEqual(Array.from(fixtureRun.jar), fixtureRun.initial);
    assert.equal(fixtureRun.counts().liveReads, 0); assert.equal(fixtureRun.counts().writes, 0);
    assert(fixtureRun.calls.some(([method, pathname]) => method === 'POST' && pathname === '/auth/v1/logout'));
    assert.equal(fixtureRun.calls.some(([method]) => method === 'revalidate'), false);
  });
}
for (const mode of ['success', 'large-success']) {
  test(`installed SSR accepted ${mode} replaces only its exact auth namespace and removes obsolete chunks`, async () => {
    const fixtureRun = fixture(mode);
    await assert.rejects(fixtureRun.run(), (error) => error.message === 'NEXT_REDIRECT' && error.url === '/today?team=finance');
    assert.equal(fixtureRun.jar.get('foreign-cookie'), 'unchanged'); assert.equal(fixtureRun.counts().liveReads, 1);
    let cookie;
    if (mode === 'success') {
      assert.equal(fixtureRun.jar.has('sb-review-auth-token.0'), false); assert.equal(fixtureRun.jar.has('sb-review-auth-token.1'), false);
      assert.equal(fixtureRun.jar.get('sb-review-auth-token.other'), 'unrelated-suffix'); cookie = fixtureRun.jar.get('sb-review-auth-token');
    } else {
      assert.equal(fixtureRun.jar.has('sb-review-auth-token'), false);
      cookie = Array.from(fixtureRun.jar).filter(([name]) => /^sb-review-auth-token\.\d+$/.test(name)).sort(([a], [b]) => Number(a.split('.').at(-1)) - Number(b.split('.').at(-1))).map(([, value]) => value).join('');
    }
    assert(cookie.startsWith('base64-')); assert.equal(JSON.parse(Buffer.from(cookie.slice(7), 'base64url').toString()).user.id, 'new-admin');
    assert.equal(fixtureRun.calls.some(([, pathname]) => pathname === '/auth/v1/logout'), false);
  });
}
test('installed SSR partial cookie publication failure rolls back exact previous values and withholds success', async () => {
  const fixtureRun = fixture('partial-write-error'); const result = await fixtureRun.run();
  assert.match(result.error, /저장하지 못했습니다/); assert.deepEqual(Array.from(fixtureRun.jar), fixtureRun.initial);
  assert.equal(fixtureRun.counts().liveReads, 1); assert(fixtureRun.counts().writes > 2);
  assert.equal(fixtureRun.calls.some(([method]) => method === 'revalidate'), false);
  assert(fixtureRun.calls.some(([, pathname, scope]) => pathname === '/auth/v1/logout' && scope === 'local'));
});
