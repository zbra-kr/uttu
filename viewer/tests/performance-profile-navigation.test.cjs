const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function load(file, role = 'viewer', options = {}) {
  const pushed = [];
  let resolveProfile;
  const listeners = new Map();
  const url = new URL(options.href || 'https://fixture.test/me');
  const browser = { location: { href: url.href, hash: url.hash }, addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
  }, removeEventListener(type, listener) { listeners.get(type)?.delete(listener); } };
  const profile = { id: 'fixture-user', email: 'viewer@example.test', full_name: 'Fixture', role, created_at: '2026-01-01' };
  const query = new Proxy({}, { get(_, name) {
    if (name === 'fetchMyProfile') return () => options.delayed ? new Promise(resolve => { resolveProfile = resolve; }) : Promise.resolve(profile);
    if (name === 'fetchMyStats' || name === 'fetchMyAiQuota') return async () => null;
    if (String(name).startsWith('fetch') || String(name).startsWith('search')) return async () => [];
    return () => { throw Error('Unexpected mutation: ' + String(name)); };
  } });
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requireFixture = id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'next/navigation') return { useRouter: () => ({ push: href => pushed.push(href) }) };
    if (id === 'next/link') return { __esModule: true, default: props => React.createElement('a', props) };
    if (id === '@/hooks/useViewport') return { useIsMobile: () => false };
    if (id.includes('/lib/queries')) return query;
    if (id.endsWith('/SubscriptionMatrix')) return { __esModule: true, default: props => React.createElement('div', { 'data-subscriptions': true, 'data-admin': props.isAdmin }) };
    return new Proxy({ __esModule: true, default: () => null }, { get: (target, key) => target[key] ?? (() => null) });
  };
  new Function('exports', 'require', 'window', code)(exports, requireFixture, browser);
  return { Component: exports.default, pushed, browser, listeners, resolveProfile: () => resolveProfile(profile), dispatch: type => listeners.get(type)?.forEach(listener => listener()) };
}

test('delayed notification target is handled once, with no focus after unrelated navigation or interaction', async () => {
  for (const scenario of ['target', 'no hash', 'hash away', 'interaction', 'URL change']) {
    const f = load('app/(app)/me/page.tsx', 'viewer', { delayed: true, href: 'https://fixture.test/me' + (scenario === 'no hash' ? '' : '#notifications') });
    const calls = [];
    let root;
    await React.act(async () => { root = Renderer.create(React.createElement(f.Component), { createNodeMock: element => element.props.id === 'notifications' ? {
      focus: options => calls.push(['focus', options]), scrollIntoView: options => calls.push(['scroll', options]),
    } : null }); });
    assert.equal(calls.length, 0);
    if (scenario === 'hash away') { f.browser.location.href = 'https://fixture.test/me#other'; f.browser.location.hash = '#other'; f.dispatch('hashchange'); }
    if (scenario === 'interaction') f.dispatch('keydown');
    if (scenario === 'URL change') f.browser.location.href = 'https://fixture.test/me?other=1#notifications';
    await React.act(async () => f.resolveProfile());
    assert.deepEqual(calls, scenario === 'target' ? [['focus', { preventScroll: true }], ['scroll', { block: 'start' }]] : []);
    assert.equal([...f.listeners.values()].reduce((total, set) => total + set.size, 0), 0);
    await React.act(async () => root.update(React.createElement(f.Component)));
    assert.equal(calls.length, scenario === 'target' ? 2 : 0);
    await React.act(async () => root.unmount());
  }
});

test('profile notification shortcut targets a labelled focusable section without dead security links', async () => {
  for (const role of ['viewer', 'admin']) {
    const { Component } = load('app/(app)/me/page.tsx', role);
    let root;
    await React.act(async () => { root = Renderer.create(React.createElement(Component)); });
    const links = root.root.findAllByType('a');
    const shortcut = links.find(link => link.props.href === '/me#notifications');
    assert.ok(shortcut);
    assert.equal(links.filter(link => link.props.href === '/settings').length, 0);
    assert.equal(root.root.findAllByType('a').some(link => link.children.includes('2FA')), false);
    const target = root.root.findByProps({ id: 'notifications' });
    assert.equal(target.type, 'section');
    assert.equal(target.props.tabIndex, -1);
    assert.equal(target.props['aria-labelledby'], 'notifications-heading');
    assert.ok(target.findByProps({ id: 'notifications-heading' }));
    assert.equal(target.findByProps({ 'data-subscriptions': true }).props['data-admin'], role === 'admin');
    await React.act(async () => root.unmount());
  }
});

test('command palette keyboard selection routes to the existing profile page', async () => {
  const { Component, pushed } = load('components/shell/CmdK.tsx');
  let root, closed = 0;
  await React.act(async () => { root = Renderer.create(React.createElement(Component, { open: true, onClose: () => closed++ })); });
  await React.act(async () => {
    root.root.findByType('input').props.onChange({ target: { value: '내 프로필' } });
    await new Promise(resolve => setTimeout(resolve, 250));
  });
  await React.act(async () => root.root.findByType('input').props.onKeyDown({ key: 'Enter', preventDefault() {} }));
  assert.deepEqual(pushed, ['/me']);
  assert.equal(closed, 1);
  await React.act(async () => root.unmount());
});
