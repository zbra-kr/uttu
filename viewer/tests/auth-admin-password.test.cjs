const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const loadSource = require('./helpers/load-source.cjs');
const oauth = loadSource('src/lib/auth/oauth.ts');
const redirect = (url) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url }); };
const privateError = { message: 'private-token-database-detail' };
process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED = 'true';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://review.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-placeholder-key';

function passwordAction(options = {}) {
  const calls = [];
  const user = { id: 'authenticated-user', identities: [{ provider: options.azure ? 'azure' : 'email' }], user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' }, factors: [{ id: 'existing-mfa-factor', status: 'verified' }] };
  const session = { access_token: 'new-access-token', refresh_token: 'new-refresh-token', user };
  const client = {
    auth: {
      async signInWithPassword(credentials) {
        calls.push(['password', credentials]);
        if (options.grantThrow) throw privateError;
        return { data: { user: options.grantNoUser ? null : user, session: options.grantMissing || options.grantError ? null : session }, error: options.grantError ? privateError : null };
      },
      async getUser(token) {
        calls.push(['verify', token]);
        if (options.userThrow) throw privateError;
        return { data: { user: options.userMissing ? null : options.userMismatch ? { ...user, id: 'other-user' } : user }, error: options.userError ? privateError : null };
      },
      async signOut(scope) {
        calls.push(['cleanup', scope]);
        assert.deepEqual(scope, { scope: 'local' });
        if (options.cleanupThrow) throw privateError;
        return { error: options.cleanupError ? privateError : null };
      },
    },
    from(table) {
      assert.equal(table, 'profiles');
      return { select(columns) {
        assert.equal(columns, 'role');
        return { eq(column, id) {
          assert.equal(column, 'id'); assert.equal(id, user.id); calls.push(['role', id]);
          return { async maybeSingle() {
            if (options.profileThrow) throw privateError;
            return { data: options.profileMissing ? null : { role: options.role === undefined ? 'admin' : options.role }, error: options.profileError ? privateError : null };
          } };
        } };
      } };
    },
  };
  const actions = loadSource('src/app/auth/actions.ts', {
    '@supabase/supabase-js': { createClient(url, key, config) {
      calls.push(['client']);
      assert.equal(url, process.env.NEXT_PUBLIC_SUPABASE_URL); assert.equal(key, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      assert.deepEqual(config, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      if (options.clientThrow) throw privateError;
      return client;
    } },
    '@/lib/auth/oauth': oauth,
    '@/lib/supabase/server': { supabaseServer: async () => assert.fail('Strict fallback cannot use live-cookie SSR') },
    '@supabase/ssr': { createServerClient(url, key, config) {
      assert(calls.some(([kind]) => kind === 'role'), 'SSR stage cannot exist before DB role check');
      assert.deepEqual(config.cookies.getAll(), [], 'SSR stage must not read current browser session');
      calls.push(['cookie-client']);
      if (options.cookieClientThrow) throw privateError;
      return {
        auth: {
          async setSession(tokens) {
            calls.push(['cookie-session', tokens]); assert.deepEqual(tokens, { access_token: session.access_token, refresh_token: session.refresh_token });
            // Emulate installed SSR's write-before-return behavior, including
            // cookie clearing on errors. These writes must stay staged.
            config.cookies.setAll([{ name: 'sb-review-auth-token', value: options.commitError ? '' : 'new-admin-cookie', options: { path: '/', sameSite: 'lax', maxAge: options.commitError ? 0 : 3600 } }]);
            if (options.commitThrow) throw privateError;
            return { data: {
              session: options.commitMissing ? null : options.commitSessionMismatch ? { ...session, user: { ...user, id: 'other-user' } } : session,
              user: options.commitUserMissing ? null : options.commitUserMismatch ? { ...user, id: 'other-user' } : user,
            }, error: options.commitError ? privateError : null };
          },
          signOut: client.auth.signOut,
        },
        from(table) {
          assert.equal(table, 'profiles');
          return { select(columns) {
            assert.equal(columns, 'role');
            return { eq(column, id) {
              assert.equal(column, 'id'); assert.equal(id, user.id); calls.push(['final-role', id]);
              return { async maybeSingle() {
                if (options.finalProfileThrow) throw privateError;
                return { data: options.finalProfileMissing ? null : { role: options.finalRole || 'admin' }, error: options.finalProfileError ? privateError : null };
              } };
            } };
          } };
        },
      };
    } },
    'next/headers': { cookies: async () => {
      calls.push(['live-read']);
      return { getAll: () => [{ name: 'sb-review-auth-token', value: 'existing-viewer-cookie' }, { name: 'theme', value: 'dark' }], set: (...args) => calls.push(['publish', ...args]) };
    } },
    'next/cache': { revalidatePath: (...args) => calls.push(['revalidate', ...args]) },
    'next/navigation': { redirect },
  });
  return { actions, calls };
}
function loginForm(next = '/today?team=finance&date=2026-10-01') {
  const form = new FormData();
  form.set('email', '  any-existing-admin@example.com  '); form.set('password', 'existing-password'); form.set('next', next);
  return form;
}
test('DB-admin fallback verifies role before writing cookies; preserved deep-link query and no email allowlist', async () => {
  const { actions, calls } = passwordAction();
  await assert.rejects(actions.signInAdmin(null, loginForm()), (error) => error.message === 'NEXT_REDIRECT' && error.url === '/today?team=finance&date=2026-10-01');
  assert.deepEqual(calls.map(([kind]) => kind), ['client', 'password', 'verify', 'role', 'cookie-client', 'cookie-session', 'final-role', 'live-read', 'publish', 'revalidate']);
  assert.equal(calls[1][1].email, 'any-existing-admin@example.com'); assert.deepEqual(calls.at(-1), ['revalidate', '/', 'layout']);
});
test('Azure-linked DB admin still has password fallback', async () => {
  const { actions, calls } = passwordAction({ azure: true });
  await assert.rejects(actions.signInAdmin(null, loginForm('/')), (error) => error.url === '/');
  assert.equal(calls.some(([kind]) => kind === 'cleanup'), false);
});
for (const [description, options, reachedCookies] of [
  ['viewer with forged metadata', { role: 'viewer' }, false], ['Azure-linked viewer', { role: 'viewer', azure: true }, false],
  ['missing profile', { profileMissing: true }, false], ['unknown role', { role: 'editor' }, false], ['null role', { role: null }, false],
  ['database error', { profileError: true }, false], ['database exception', { profileThrow: true }, false],
  ['Auth user error', { userError: true }, false], ['Auth user missing', { userMissing: true }, false], ['Auth user mismatch', { userMismatch: true }, false], ['Auth user exception', { userThrow: true }, false],
  ['grant missing user', { grantNoUser: true }, false], ['cookie commit error', { commitError: true }, true], ['cookie commit exception', { commitThrow: true }, true], ['cookie commit missing session', { commitMissing: true }, true], ['cookie client exception', { cookieClientThrow: true }, true],
  ['cookie commit missing user', { commitUserMissing: true }, true], ['cookie commit mismatched user', { commitUserMismatch: true }, true], ['cookie commit mismatched session user', { commitSessionMismatch: true }, true],
  ['final admin demotion', { finalRole: 'viewer' }, true], ['final profile missing', { finalProfileMissing: true }, true], ['final profile error', { finalProfileError: true }, true], ['final profile exception', { finalProfileThrow: true }, true],
  ['viewer cleanup network failure', { role: 'viewer', cleanupThrow: true }, false], ['viewer cleanup API error', { role: 'viewer', cleanupError: true }, false],
]) {
  test(`${description} fails closed with local-only transient cleanup`, async () => {
    const { actions, calls } = passwordAction(options);
    const result = await actions.signInAdmin(null, loginForm());
    assert.match(result.error, /관리자 계정/); assert.doesNotMatch(result.error, /private-token-database-detail/);
    assert.equal(calls.filter(([kind]) => kind === 'cleanup').length, 1);
    assert.equal(calls.some(([kind]) => kind === 'cookie-client'), reachedCookies);
    assert.equal(calls.some(([kind]) => ['live-read', 'publish', 'revalidate'].includes(kind)), false);
  });
}
for (const options of [{ grantError: true }, { grantMissing: true }, { grantThrow: true }, { clientThrow: true }]) {
  test(`failed password request cannot affect browser sessions: ${JSON.stringify(options)}`, async () => {
    const { actions, calls } = passwordAction(options);
    assert.match((await actions.signInAdmin(null, loginForm())).error, /관리자 계정/);
    assert.equal(calls.some(([kind]) => ['cookie-client', 'cleanup', 'revalidate'].includes(kind)), false);
  });
}
for (const next of ['//evil.example', 'https://evil.example', '/admin-login?redirect=/today', '/signup', '/auth/callback?code=stale', '/\\evil.example']) {
  test(`admin fallback neutralizes unsafe/looping redirect: ${next}`, async () => {
    const { actions } = passwordAction(); await assert.rejects(actions.signInAdmin(null, loginForm(next)), (error) => error.url === '/');
  });
}
test('malformed password form fails before Auth calls', async () => {
  const { actions, calls } = passwordAction();
  assert.match((await actions.signInAdmin(null, new FormData())).error, /관리자 계정/);
  const form = loginForm(); form.set('password', new Blob(['not-a-password']));
  assert.match((await actions.signInAdmin(null, form)).error, /관리자 계정/); assert.deepEqual(calls, []);
});
test('stale signup action fails closed without Auth calls or transmitting inputs', async () => {
  const { actions, calls } = passwordAction();
  const result = await actions.signUp(null, { get() { assert.fail('Signup must not inspect inputs'); } });
  assert.match(result.error, /회사 Microsoft 계정/); assert.equal(result.success, undefined); assert.deepEqual(calls, []);
});
function loginUI({ mobile, pending = false, formError = null }) {
  const hooks = { useFormState: () => [formError && { error: formError }, '/test-action'], useFormStatus: () => ({ pending }) };
  const link = (props) => React.createElement('a', props, props.children);
  const AdminPasswordForm = loadSource('src/app/admin-login/AdminPasswordForm.tsx', { 'react-dom': hooks, '../auth/actions': { signIn: () => {}, signInAdmin: () => {} } }).default;
  const MicrosoftLogin = loadSource('src/app/login/MicrosoftLogin.tsx', { 'react-dom': hooks, '../auth/microsoft': { signInWithMicrosoft: () => {} } }).default;
  const shared = { 'next/link': link, '../admin-login/AdminPasswordForm': AdminPasswordForm, './MicrosoftLogin': MicrosoftLogin };
  const MobileLoginView = loadSource('src/app/login/MobileLoginView.tsx', shared).default;
  const LoginView = loadSource('src/app/login/LoginView.tsx', { ...shared, '@/hooks/useViewport': { useIsMobile: () => mobile }, './MobileLoginView': MobileLoginView }).default;
  return {
    normal: loadSource('src/app/login/page.tsx', { './LoginView': LoginView, '@/lib/auth/oauth': oauth }).default,
    admin: loadSource('src/app/admin-login/page.tsx', { '../login/LoginView': LoginView, '@/lib/auth/oauth': oauth }).default,
  };
}
for (const mobile of [false, true]) {
  for (const admin of [false, true]) {
    test(`${mobile ? 'mobile' : 'desktop'} ${admin ? 'admin' : 'normal'} UI renders only permitted entry`, async () => {
      const saved = process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED; process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED = 'true';
      try {
        const component = loginUI({ mobile })[admin ? 'admin' : 'normal'];
        const html = renderToStaticMarkup(await component({ searchParams: Promise.resolve({ redirect: '/today?team=finance&date=today' }) }));
        assert.equal(html.includes('name="email"'), admin); assert.equal(html.includes('type="password"'), admin);
        assert.equal(html.includes('회사 Microsoft 계정으로 로그인'), !admin); assert.equal(html.includes('href="/forgot-password"'), admin);
        assert.doesNotMatch(html, /href="\/signup"|계정 만들기|name="full_name"/); assert.match(html, /name="next" value="\/today\?team=finance&amp;date=today"/);
        assert(html.includes(admin ? 'href="/login?redirect=%2Ftoday%3Fteam%3Dfinance%26date%3Dtoday"' : 'href="/admin-login?redirect=%2Ftoday%3Fteam%3Dfinance%26date%3Dtoday"'));
        assert.equal(html.includes('min-height:100dvh'), mobile);
      } finally { if (saved === undefined) delete process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED; else process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED = saved; }
    });
  }
  test(`${mobile ? 'mobile' : 'desktop'} admin form disables repeat submission, displays error, sanitizes next`, async () => {
    const { admin } = loginUI({ mobile, pending: true, formError: '관리자 계정을 확인해 주세요.' });
    const html = renderToStaticMarkup(await admin({ searchParams: Promise.resolve({ redirect: '//evil.example' }) }));
    assert.match(html, /disabled=""/); assert.match(html, /aria-busy="true"/); assert.match(html, /로그인 중…/); assert.match(html, /role="alert"/); assert.match(html, /관리자 계정을 확인해 주세요/); assert.match(html, /name="next" value="\/"/);
  });
  test(`${mobile ? 'mobile' : 'desktop'} disabled Microsoft rollout never exposes ordinary password fields`, async () => {
    const saved = process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED; delete process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED;
    try {
      const { normal } = loginUI({ mobile }); const html = renderToStaticMarkup(await normal({}));
      assert.doesNotMatch(html, /type="password"|name="email"|회사 Microsoft 계정으로 로그인/); assert.match(html, /Microsoft 로그인을 준비 중/); assert.match(html, /href="\/admin-login"/);
    } finally { if (saved !== undefined) process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED = saved; }
  });
}
for (const [next, destination] of [['/today?team=finance', '/login?redirect=%2Ftoday%3Fteam%3Dfinance'], ['//evil.example', '/login'], ['/admin-login', '/login']]) {
  test(`legacy signup route has no email UI and redirects safely: ${next}`, async () => {
    const SignupPage = loadSource('src/app/signup/page.tsx', { '@/lib/auth/oauth': oauth, 'next/navigation': { redirect }, './SignupView': () => null }).default;
    await assert.rejects(SignupPage({ searchParams: Promise.resolve({ redirect: next }) }), (error) => error.url === destination);
  });
}
function middleware(user) {
  return loadSource('src/middleware.ts', {
    '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
    'next/server': { NextResponse: { next: () => ({ kind: 'next', cookies: { set() {} } }), redirect: (url) => ({ kind: 'redirect', url: new URL(url) }) } },
  }).middleware;
}
function request(url) { return { url, nextUrl: new URL(url), headers: new Headers(), cookies: { getAll: () => [], set() {} } }; }
for (const pathname of ['/login', '/admin-login', '/signup', '/forgot-password']) {
  test(`public ${pathname} handles existing viewer sessions safely`, async () => {
    const req = request(`https://uttu.bcave.ai${pathname}?redirect=/today`);
    assert.equal((await middleware(null)(req)).kind, 'next');
    const result = await middleware({ id: 'existing-viewer' })(req);
    if (pathname === '/admin-login') assert.equal(result.kind, 'next');
    else { assert.equal(result.kind, 'redirect'); assert.equal(result.url.href, 'https://uttu.bcave.ai/'); }
  });
}
test('protected route requires login and safely preserves full query', async () => {
  const result = await middleware(null)(request('https://uttu.bcave.ai/admin/users?filter=active&next=//evil.example'));
  assert.equal(result.url.origin, 'https://uttu.bcave.ai'); assert.equal(result.url.pathname, '/login'); assert.equal(result.url.searchParams.get('redirect'), '/admin/users?filter=active&next=//evil.example');
  assert.equal((await middleware({ id: 'user' })(request('https://uttu.bcave.ai/admin/users'))).kind, 'next');
});

async function withOnlyFlag(value, fn) {
  const saved = process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED;
  if (value === undefined) delete process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED;
  else process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED = value;
  try { return await fn(); }
  finally { if (saved === undefined) delete process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED; else process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED = saved; }
}

for (const flag of [undefined, 'false']) {
  test(`missing/false policy flag preserves legacy viewer password login: ${flag}`, async () => {
    await withOnlyFlag(flag, async () => {
      const calls = [];
      const actions = loadSource('src/app/auth/actions.ts', {
        '@supabase/supabase-js': { createClient: () => assert.fail('Legacy login must not invoke strict grant') },
        '@supabase/ssr': { createServerClient: () => assert.fail('Legacy login must not invoke staged SSR') },
        'next/headers': { cookies: () => assert.fail('Legacy login must use its existing cookie adapter') },
        '@/lib/auth/oauth': oauth,
        '@/lib/supabase/server': { supabaseServer: async () => ({ auth: { signInWithPassword: async (credentials) => { calls.push(credentials); return { error: null }; } } }) },
        'next/navigation': { redirect }, 'next/cache': { revalidatePath: () => {} },
      });
      await assert.rejects(actions.signIn(null, loginForm('/today')), (error) => error.url === '/');
      assert.deepEqual(calls, [{ email: '  any-existing-admin@example.com  ', password: 'existing-password' }]);
    });
  });
  test(`missing/false policy flag preserves legacy email signup: ${flag}`, async () => {
    await withOnlyFlag(flag, async () => {
      const calls = [];
      const actions = loadSource('src/app/auth/actions.ts', {
        '@supabase/supabase-js': { createClient: () => assert.fail('Legacy signup cannot invoke strict grant') },
        '@supabase/ssr': { createServerClient: () => assert.fail('Legacy signup cannot invoke strict SSR') },
        'next/headers': { cookies: () => assert.fail('Legacy signup cannot invoke staged publisher') },
        '@/lib/auth/oauth': oauth,
        '@/lib/supabase/server': { supabaseServer: async () => ({ auth: { signUp: async (credentials) => { calls.push(credentials); return { data: { user: null }, error: null }; } } }) },
        'next/navigation': { redirect }, 'next/cache': { revalidatePath: () => {} },
      });
      const form = new FormData(); form.set('email', 'viewer@bcave.co.kr'); form.set('password', 'legacy-password'); form.set('full_name', ' Legacy Name ');
      assert.match((await actions.signUp(null, form)).success, /가입 완료/);
      assert.equal(calls.length, 1); assert.equal(calls[0].email, 'viewer@bcave.co.kr'); assert.equal(calls[0].options.data.full_name, 'Legacy Name');
      assert.match(calls[0].options.emailRedirectTo, /\/auth\/callback$/);
      form.set('email', 'viewer@other.example'); assert.match((await actions.signUp(null, form)).error, /도메인/); assert.equal(calls.length, 1);
    });
  });
  test(`missing/false policy flag leaves strict admin test route available: ${flag}`, async () => {
    await withOnlyFlag(flag, async () => {
      const { actions, calls } = passwordAction({ role: 'viewer' });
      assert.match((await actions.signInAdmin(null, loginForm())).error, /관리자 계정/);
      assert.equal(calls.some(([kind]) => ['live-read', 'publish'].includes(kind)), false);
    });
  });
  for (const mobile of [false, true]) {
    test(`${mobile ? 'mobile' : 'desktop'} missing/false flag preserves password + Microsoft and signup links: ${flag}`, async () => {
      await withOnlyFlag(flag, async () => {
        const saved = process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED; process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED = 'true';
        try {
          const { normal, admin } = loginUI({ mobile });
          const html = renderToStaticMarkup(await normal({}));
          assert.match(html, /name="email"/); assert.match(html, /type="password"/); assert.match(html, /회사 Microsoft 계정으로 로그인/);
          assert.match(html, /href="\/signup"/); assert.match(html, /href="\/forgot-password"/); assert.match(html, /href="\/admin-login"/);
          if (mobile) assert.match(html, /flex-wrap:wrap/);
          const adminHTML = renderToStaticMarkup(await admin({}));
          assert.match(adminHTML, /관리자 로그인/); assert.match(adminHTML, /type="password"/); assert.doesNotMatch(adminHTML, /href="\/signup"/);
        } finally { if (saved === undefined) delete process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED; else process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED = saved; }
      });
    });
    test(`${mobile ? 'mobile' : 'desktop'} missing/false flag preserves signup form UI: ${flag}`, async () => {
      await withOnlyFlag(flag, async () => {
        const hooks = { useFormState: () => [null, '/legacy-signup'], useFormStatus: () => ({ pending: false }) };
        const common = { 'react-dom': hooks, '../auth/actions': { signUp: () => {} }, 'next/link': (props) => React.createElement('a', props, props.children) };
        const MobileSignupView = loadSource('src/app/signup/MobileSignupView.tsx', common).default;
        const SignupView = loadSource('src/app/signup/SignupView.tsx', { ...common, '@/hooks/useViewport': { useIsMobile: () => mobile }, './MobileSignupView': MobileSignupView }).default;
        const SignupPage = loadSource('src/app/signup/page.tsx', { '@/lib/auth/oauth': oauth, 'next/navigation': { redirect }, './SignupView': SignupView }).default;
        const html = renderToStaticMarkup(await SignupPage({}));
        assert.match(html, /name="full_name"/); assert.match(html, /name="email"/); assert.match(html, /type="password"/); assert.match(html, /계정 만들기/);
      });
    });
  }
}

test('enabled policy routes stale generic signIn forms through strict admin verification', async () => {
  await withOnlyFlag('true', async () => {
    const { actions, calls } = passwordAction({ role: 'viewer', azure: true });
    assert.match((await actions.signIn(null, loginForm())).error, /관리자 계정/);
    assert.equal(calls.some(([kind]) => ['live-read', 'publish'].includes(kind)), false);
    assert.deepEqual(calls.find(([kind]) => kind === 'cleanup')[1], { scope: 'local' });
  });
});
