const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const oauth = load('src/lib/auth/oauth.ts');
const navigation = load('src/lib/teams/setup-navigation.ts', { '@/lib/auth/oauth': oauth });

for (const path of ['/', '/today', '/market?brand=a&date=2026-10-01', '/me#settings']) {
  test(`setup preserves the app destination ${path}`, () => {
    assert.equal(navigation.safeTeamsSetupNext(path), path);
    const url = new URL(navigation.teamsSetupPath(path, true), 'https://uttu.test');
    assert.equal(url.pathname, '/setup/teams');
    assert.equal(url.searchParams.get('next'), path);
    assert.equal(url.searchParams.get('attempted'), '1');
  });
}
for (const path of [undefined, [], 'https://evil.test/', '//evil.test/', '/\\evil.test',
  '/auth/teams/callback', '/auth/callback?code=secret', '/setup/teams?next=/me', '/api/me/teams/connection',
  '/login', '/admin-login', '/signup', '/AUTH/teams', '/%61uth/teams', '/%2573etup/teams',
  '/foo%2f..%2fauth/teams', '/%252f%252fevil.test', '/bad%zz', '/bad%0a', '/setup']) {
  test(`setup rejects unsafe or looping destination ${JSON.stringify(path)}`, () => {
    assert.equal(navigation.safeTeamsSetupNext(path), '/');
  });
}

function page(context) {
  return load('src/app/setup/teams/page.tsx', {
    '@/lib/teams/setup-context': { getTeamsSetupContext: async () => context },
    '@/lib/teams/setup-navigation': navigation,
    './TeamsSetupClient': { default: 'teams-setup-client' },
    'next/navigation': { redirect: url => { throw Object.assign(new Error('Redirect'), { url }); } },
  }).default;
}

test('setup sends an unauthenticated user to login with only a safe saved destination', async () => {
  await assert.rejects(page({ user: null })({ searchParams: { next: '/market?brand=a' } }),
    error => error.url === '/login?redirect=%2Fmarket%3Fbrand%3Da');
});
test('only the trusted server decision permits app entry, including DB-role admin exception', async () => {
  for (const reason of ['admin_exempt', 'connected', 'disabled']) {
    await assert.rejects(page({ user: { id: 'u' }, decision: { allowed: true, reason } })({ searchParams: { next: '/today' } }),
      error => error.url === '/today');
  }
});
test('already-allowed optional callback failures remain visible on the profile', async () => {
  await assert.rejects(page({ user: { id: 'u' }, decision: { allowed: true, reason: 'connected' } })({ searchParams: { error: 'oauth', next: '/today' } }),
    error => error.url === '/me?teams=failed');
});
test('browser success text never bypasses the setup decision or serializes user data', async () => {
  const result = await page({ user: { id: 'private-id', email: 'private@example.test' }, required: true,
    decision: { allowed: false, reason: 'reconnect_required' }, canConnect: true })({ searchParams: {
    teams: 'connected', next: '//evil.test/', error: 'oauth', attempted: '1',
  } });
  assert.deepEqual(result.props, { nextPath: '/', reason: 'reconnect_required', canConnect: true, initialError: true, attempted: true });
  assert.doesNotMatch(JSON.stringify(result.props), /private/);
});

function elements(node, type) {
  if (!node || typeof node !== 'object') return [];
  const result = node.type === type ? [node] : [];
  for (const child of [node.props?.children].flat(Infinity)) result.push(...elements(child, type));
  return result;
}
function renderedText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  return [node.props?.children].flat(Infinity).map(renderedText).join(' ');
}
const microsoftUrl = 'https://login.microsoftonline.com/09cefcf6-a744-4cc2-a8ec-681fe0d1a85a/oauth2/v2.0/authorize?state=opaque';
const tick = () => new Promise(resolve => setImmediate(resolve));

function client(t, options = {}) {
  const oldWindow = global.window;
  const oldFetch = global.fetch;
  const calls = [], navigations = [], states = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0;
  const timers = new Map(); let timerId = 0;
  global.window = {
    location: { href: options.href || 'https://uttu.test/setup/teams?next=%2Ftoday',
      assign: url => navigations.push(['assign', url]), replace: url => navigations.push(['replace', url]),
      reload: () => navigations.push(['reload']) },
    history: { state: {}, replaceState: (_state, _title, url) => {
      global.window.location.href = new URL(url, 'https://uttu.test').toString();
    } },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  global.fetch = async (url, init) => {
    calls.push({ url, init, page: global.window.location.href });
    return options.fetch ? options.fetch(url, init) : { ok: true, json: async () => ({ url: microsoftUrl }) };
  };
  t.after(() => { global.window = oldWindow; global.fetch = oldFetch; });
  const source = load('src/app/setup/teams/TeamsSetupClient.tsx', {
    '@/lib/teams/setup-navigation': navigation,
    './teams-setup.module.css': { default: {} },
    react: {
      useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
      useRef: initial => { const i = refIndex++; refs[i] ||= { current: initial }; return refs[i]; },
      useCallback: fn => fn,
      useEffect: fn => effects.push(fn),
    },
  });
  const props = { nextPath: '/today', reason: 'setup_required', canConnect: true, initialError: false, attempted: false, ...options.props };
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return source.default(props); };
  return { calls, navigations, timers, render, effects, source, props };
}

test('automatic connection runs once, marking history before the only POST', async t => {
  const ui = client(t); ui.render();
  ui.effects[0](); ui.effects[0](); await tick();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].url, '/api/me/teams/connection');
  assert.deepEqual(JSON.parse(ui.calls[0].init.body), { action: 'connect', return_to: '/today' });
  assert.equal(new URL(ui.calls[0].page).searchParams.get('attempted'), '1');
  assert.deepEqual(ui.navigations, [['assign', microsoftUrl]]);
  assert.equal(ui.timers.size, 0);
});

for (const options of [
  { props: { initialError: true } }, { props: { attempted: true } },
  { href: 'https://uttu.test/setup/teams?attempted=1' },
  { props: { canConnect: false } }, { props: { reason: 'identity_required' } },
  { props: { reason: 'unavailable' } },
]) {
  test(`no automatic loop in interrupted or unavailable state ${JSON.stringify(options)}`, async t => {
    const ui = client(t, options); ui.render(); ui.effects[0](); await tick();
    assert.equal(ui.calls.length, 0); assert.equal(ui.navigations.length, 0);
  });
}

test('explicit retry after cancellation works and repeated clicks are deduplicated', async t => {
  let finish;
  const ui = client(t, { props: { initialError: true }, fetch: () => new Promise(resolve => { finish = resolve; }) });
  const tree = ui.render();
  const retry = elements(tree, 'button')[0];
  assert.match(renderedText(retry), /다시 연결/);
  retry.props.onClick(); retry.props.onClick();
  assert.equal(ui.calls.length, 1);
  finish({ ok: true, json: async () => ({ url: microsoftUrl }) }); await tick();
  assert.deepEqual(ui.navigations, [['assign', microsoftUrl]]);
});

test('provider details and fake success response are never rendered as connection success', async t => {
  const ui = client(t, { fetch: async () => ({ ok: true, json: async () => ({ connected: true, error: 'provider-secret-text' }) }) });
  ui.render(); ui.effects[0](); await tick();
  const text = renderedText(ui.render());
  assert.match(text, /연결 요청을 완료하지 못했습니다/);
  assert.doesNotMatch(text, /provider-secret-text|연결되었습니다/);
  assert.equal(ui.navigations.length, 0);
});

test('timeout leaves a visible retry path', async t => {
  const ui = client(t, { fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')))) });
  ui.render(); ui.effects[0]();
  for (const callback of ui.timers.values()) callback(); await tick();
  const tree = ui.render();
  assert.match(renderedText(tree), /연결 요청을 완료하지 못했습니다/);
  assert.equal(elements(tree, 'button')[0].props.disabled, false);
});

test('signout cancels connection navigation and uses only the local-session endpoint', async t => {
  let finishConnect;
  const ui = client(t, { fetch: url => url === '/api/me/teams/connection'
    ? new Promise(resolve => { finishConnect = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ url: '/login' }) }) });
  const tree = ui.render(); ui.effects[0]();
  elements(tree, 'button')[1].props.onClick();
  assert.equal(ui.calls[0].init.signal.aborted, true);
  finishConnect({ ok: true, json: async () => ({ url: microsoftUrl }) }); await tick();
  assert.deepEqual(ui.calls.map(c => c.url), ['/api/me/teams/connection', '/api/auth/local-signout']);
  assert.deepEqual(ui.navigations, [['replace', '/login']]);
});

test('a failed logout still prevents an aborted connection from navigating later', async t => {
  let finishConnect;
  const ui = client(t, { fetch: url => url === '/api/me/teams/connection'
    ? new Promise(resolve => { finishConnect = resolve; })
    : Promise.resolve({ ok: false }) });
  const tree = ui.render(); ui.effects[0]();
  elements(tree, 'button')[1].props.onClick(); await tick();
  assert.match(renderedText(ui.render()), /로그아웃을 완료하지 못했습니다/);
  finishConnect({ ok: true, json: async () => ({ url: microsoftUrl }) }); await tick();
  assert.equal(ui.navigations.length, 0);
});

test('signout rejects an untrusted return URL and retains a retry button', async t => {
  const ui = client(t, { props: { attempted: true }, fetch: async () => ({ ok: true, json: async () => ({ url: 'https://evil.test' }) }) });
  elements(ui.render(), 'button')[1].props.onClick(); await tick();
  const tree = ui.render();
  assert.match(renderedText(tree), /로그아웃을 완료하지 못했습니다/);
  assert.equal(elements(tree, 'button')[1].props.disabled, false);
  assert.equal(ui.navigations.length, 0);
});

test('unavailable and identity-required screens retain clear recovery without requesting OAuth', t => {
  const unavailable = client(t, { props: { canConnect: false, reason: 'unavailable' } });
  const tree = unavailable.render();
  assert.match(renderedText(tree), /연결 상태 다시 확인/);
  assert.match(renderedText(tree), /IT팀/);
  elements(tree, 'button')[0].props.onClick();
  assert.deepEqual(unavailable.navigations, [['reload']]);
  assert.match(global.window.location.href, /attempted=1/);
  unavailable.props.reason = 'identity_required';
  const identityTree = unavailable.render();
  assert.equal(elements(identityTree, 'button').length, 1);
  assert.match(renderedText(identityTree), /회사 Microsoft 계정으로 다시 로그인/);
});

test('only an HTTPS Microsoft authorize URL is accepted', t => {
  const ui = client(t);
  assert.equal(ui.source.microsoftConnectionUrl(microsoftUrl), microsoftUrl);
  for (const value of [null, {}, '/login', 'javascript:alert(1)', 'http://login.microsoftonline.com/t/oauth2/v2.0/authorize',
    'https://login.microsoftonline.com.evil.test/t/oauth2/v2.0/authorize',
    'https://user:secret@login.microsoftonline.com/t/oauth2/v2.0/authorize',
    'https://login.microsoftonline.com:444/t/oauth2/v2.0/authorize', 'https://login.microsoftonline.com/unexpected']) {
    assert.equal(ui.source.microsoftConnectionUrl(value), null);
  }
});
