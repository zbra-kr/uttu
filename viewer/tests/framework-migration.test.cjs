const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-source.cjs');
const { NextRequest } = require('next/server');
const { isStaticGenEnabled } = require('next/dist/server/route-modules/app-route/helpers/is-static-gen-enabled');

// All external boundaries are mocked; accidental network use is a hard failure.
const originalFetch = global.fetch;
before(() => { global.fetch = async () => assert.fail('Migration tests must stay offline'); });
after(() => { global.fetch = originalFetch; });
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://offline.example.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service';
const id = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';

const routes = [
  ['companies/[id]/corp-code', 'PATCH', { corp_code: '12345678', is_listed: false }],
  ['companies/[id]/dart-skip', 'PATCH', { skip: true }],
  ['companies/[id]/parent', 'PATCH', { parent_company_id: null }],
  ['companies/[id]/remark', 'PATCH', { remark: 'synthetic memo' }],
  ['brands/[id]/company', 'PATCH', { company_id: null }],
  ['brands/[id]/company-skip', 'PATCH', { skip: true }],
  ['brands/[id]/remark', 'PATCH', { remark: 'synthetic memo' }],
  ['admin/anomalies/rules/[id]', 'PATCH', { label: 'synthetic label' }],
  ['admin/anomalies/rules/[id]', 'DELETE', undefined, 204],
  ['admin/jobs/[id]', 'GET'],
  ['admin/llm/models/[id]', 'PATCH', { display_name: 'synthetic model' }],
  ['admin/llm/models/[id]', 'DELETE'],
  ['admin/users/[id]', 'PATCH', { profile: { display_name: 'synthetic user' } }],
  ['admin/users/[id]/sessions', 'GET'],
];
function fixture(route, method, body, denied = false, dbError = false) {
  const calls = [];
  const sb = { from(table) {
    const entry = { table, filters: [] }; calls.push(entry);
    const query = {};
    for (const op of ['select', 'update', 'upsert', 'delete', 'order', 'limit']) {
      query[op] = (...args) => { entry[op] = args; return query; };
    }
    for (const op of ['eq', 'neq']) query[op] = (...args) => { entry.filters.push([op, ...args]); return query; };
    const result = () => ({ data: dbError ? null : table === 'ai_sessions' ? [] : { id, module: 'custom', is_default: false }, error: dbError ? { message: 'offline database unavailable' } : null });
    query.single = async () => result();
    query.maybeSingle = async () => ({ data: null, error: null });
    query.then = (yes, no) => Promise.resolve(result()).then(yes, no);
    return query;
  } };
  const mod = load(`src/app/api/${route}/route.ts`, {
    '@/lib/auth/require-admin': { requireAdmin: async () => ({ error: denied ? new Response(null, { status: 403 }) : null, user: { id: adminId }, ss: sb }) },
    '@supabase/supabase-js': { createClient: () => sb },
  });
  const request = () => new NextRequest(`https://uttu.test/api/${route.replace('[id]', id)}?limit=5`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  return { run: params => mod[method](request(), { params }), calls };
}
for (const [route, method, body, status = 200] of routes) {
  test(`${method} ${route} awaits route params and preserves exact record scope`, async () => {
    const f = fixture(route, method, body);
    const response = await f.run(Promise.resolve({ id }));
    assert.equal(response.status, status);
    assert(f.calls.length > 0);
    for (const call of f.calls) {
      const targets = call.filters.filter(([op, key]) => ['id', 'user_id'].includes(key));
      assert(targets.length, `Missing record restriction on ${call.table}`);
      assert(targets.every(([, , value]) => value === id));
    }
  });
  test(`${method} ${route} rejects non-admin before touching params or records`, async () => {
    const f = fixture(route, method, body, true);
    const response = await f.run({ then() { assert.fail('Auth rejection must not consume route params'); } });
    assert.equal(response.status, 403); assert.deepEqual(f.calls, []);
  });
}
test('dynamic job lookup preserves database-error response', async () => {
  const f = fixture('admin/jobs/[id]', 'GET', undefined, false, true);
  assert.equal((await f.run(Promise.resolve({ id }))).status, 500);
});
test('company parent self-reference still fails before any database call with promised params', async () => {
  const f = fixture('companies/[id]/parent', 'PATCH', { parent_company_id: id });
  assert.equal((await f.run(Promise.resolve({ id }))).status, 400); assert.deepEqual(f.calls, []);
});

for (const name of ['chat', 'messages', 'quota', 'sessions']) {
  test(`AI ${name} consumes async cookies before authentication and never creates a service client for anonymous users`, async () => {
    let cookieReads = 0, authReads = 0;
    const mocks = {
      'next/headers': { cookies: async () => { await Promise.resolve(); return { get: () => { cookieReads++; return { value: 'synthetic-cookie' }; } }; } },
      '@supabase/ssr': { createServerClient: (_url, _key, options) => {
        assert.equal(options.cookies.get('test-cookie'), 'synthetic-cookie');
        return { auth: { getUser: async () => { authReads++; return { data: { user: null }, error: null }; } } };
      } },
      '@supabase/supabase-js': { createClient: () => assert.fail('No anonymous service client') },
      '@anthropic-ai/sdk': class {}, openai: class {}, '@google/generative-ai': { GoogleGenerativeAI: class {} },
      '@/lib/ai/pipeline': { AI_QUERY_BLOCKED_TABLES: [], execQueryDb: () => assert.fail('No inference or query') },
    };
    const mod = load(`src/app/api/ai/${name}/route.ts`, mocks);
    const request = new NextRequest(`https://uttu.test/api/ai/${name}?sessionId=${id}`, name === 'chat' ? {
      method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', text: 'offline' }], context: [], sessionId: id }),
    } : undefined);
    const response = await mod[name === 'chat' ? 'POST' : 'GET'](request);
    assert.equal(response.status, name === 'sessions' ? 200 : 401);
    assert.equal(cookieReads, 1); assert.equal(authReads, 1);
    if (name === 'sessions') assert.deepEqual(await response.json(), { sessions: [] });
  });
}
for (const [label, gateway, allowed, expected] of [
  ['bad secret', 'wrong', true, 404], ['disallowed egress', 'synthetic-gateway', false, 404], ['authorized egress', 'synthetic-gateway', true, 200],
]) test(`MCP promised gateway preserves ${label} boundary`, async () => {
  process.env.MCP_GATEWAY_SECRET = 'synthetic-gateway';
  let inits = 0, invocations = 0, egressChecks = 0;
  const mod = load('src/app/api/mcp/[gateway]/route.ts', {
    '@/lib/mcp/anthropic-egress': { isAnthropicEgress: () => { egressChecks++; return { allowed, ip: '192.0.2.1', reason: 'offline' }; } },
    '@/lib/mcp/handler': { createUttuMcpHandler: prefix => {
      assert.equal(prefix, '/api/mcp/synthetic-gateway'); inits++;
      return async () => { invocations++; return new Response('offline', { status: 200 }); };
    } },
  });
  for (const method of ['GET', 'POST']) {
    const response = await mod[method](new NextRequest(`https://uttu.test/api/mcp/${gateway}`, { method }), { params: Promise.resolve({ gateway }) });
    assert.equal(response.status, expected);
  }
  assert.equal(inits, expected === 200 ? 1 : 0);
  assert.equal(invocations, expected === 200 ? 2 : 0);
  assert.equal(egressChecks, label === 'bad secret' ? 0 : 2);
  delete process.env.MCP_GATEWAY_SECRET;
});

for (const route of ['login', 'admin-login']) {
  for (const redirect of ['/today?date=2026-10-03', '//evil.test', ['/today', '//evil.test']]) {
    test(`${route} server page awaits query without weakening redirect/error sanitization: ${JSON.stringify(redirect)}`, async () => {
      const mod = load(`src/app/${route}/page.tsx`, {
        [route === 'login' ? './LoginView' : '../login/LoginView']: () => null,
      });
      const rendered = await mod.default({ searchParams: Promise.resolve({ redirect, error: 'access_token=private' }) });
      assert.equal(rendered.props.next, typeof redirect === 'string' && redirect.startsWith('/today') ? redirect : '/');
      assert.doesNotMatch(JSON.stringify(rendered.props), /private|evil/);
      assert.equal((await mod.default({})).props.next, '/');
    });
  }
}
test('promised setup query preserves server-only gate and does not accept browser success as proof', async () => {
  const mod = load('src/app/setup/teams/page.tsx', {
    '@/lib/teams/setup-context': { getTeamsSetupContext: async () => ({ user: { id }, decision: { allowed: false, reason: 'reconnect_required' }, canConnect: true }) },
    './TeamsSetupClient': () => null,
  });
  const rendered = await mod.default({ searchParams: Promise.resolve({ next: '/today?date=2026-10-03', error: 'oauth', attempted: '1', teams: 'connected' }) });
  assert.deepEqual(rendered.props, { nextPath: '/today?date=2026-10-03', reason: 'reconnect_required', canConnect: true, initialError: true, attempted: true });
});
test('missing memo id preserves installed Next not-found signal before any database access', async () => {
  const mod = load('src/app/(app)/me/notes/[id]/page.tsx', {
    '@/lib/supabase/server': { supabaseServer: () => assert.fail('Invalid ID must never query') },
  });
  await assert.rejects(mod.default({ params: Promise.resolve({ id: 'invalid' }) }), error => error.digest === 'NEXT_HTTP_ERROR_FALLBACK;404');
});
test('signup server redirect preserves installed Next redirect signal with promised query', async () => {
  const old = process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED;
  process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED = 'true';
  try {
    const mod = load('src/app/signup/page.tsx', { './SignupView': () => null });
    await assert.rejects(mod.default({ searchParams: Promise.resolve({ redirect: '/today?date=2026-10-03' }) }), error => error.digest === 'NEXT_REDIRECT;replace;/login?redirect=%2Ftoday%3Fdate%3D2026-10-03;307;');
  } finally {
    if (old === undefined) delete process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED; else process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED = old;
  }
});
test('public stats keeps hourly static eligibility while authenticated routes stay dynamic', () => {
  const stats = load('src/app/api/stats/route.ts', { '@supabase/supabase-js': { createClient: () => assert.fail('No database') } });
  assert.equal(stats.revalidate, 3600);
  assert.equal(isStaticGenEnabled(stats), true);
  for (const name of ['quota', 'sessions', 'messages']) {
    const source = fs.readFileSync(path.resolve(__dirname, `../src/app/api/ai/${name}/route.ts`), 'utf8');
    assert.doesNotMatch(source, /force-static|force-cache|revalidate\s*=/);
    assert.match(source, /await cookies\(\)/);
  }
});
test('migration stays on pinned maintenance framework and consistent React/type line', () => {
  const p = require('../package.json');
  assert.equal(p.dependencies.next, '15.5.27'); assert.equal(p.devDependencies['eslint-config-next'], '15.5.27');
  assert.equal(p.dependencies.react, '19.2.8'); assert.equal(p.dependencies['react-dom'], '19.2.8');
  assert.equal(p.devDependencies['@types/react'], '19.2.18'); assert.equal(p.devDependencies['@types/react-dom'], '19.2.7');
});
