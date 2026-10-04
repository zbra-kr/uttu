const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
const React = require('react');
const Renderer = require('react-test-renderer');
const { renderToString } = require('react-dom/server');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { helpPagePath } = load('src/lib/help-page-path.ts');

for (const path of [
  '/', '/ranking', '/product', '/brand', '/search', '/me', '/me/notes',
  '/admin', '/admin/guides', '/admin/guides/new', '/admin/users',
  '/me/notes/[id]', '/admin/guides/[id]',
]) {
  test(`static help path is preserved: ${path}`, () => {
    assert.equal(helpPagePath(path), path);
  });
}

for (const prefix of ['/me/notes', '/admin/guides']) {
  for (const id of ['12345678-abcd-4abc-8abc-1234567890ab', 'ABCDEF12-3456-7890-ABCD-EF1234567890']) {
    test(`UUID detail maps to its literal [id] article: ${prefix}/${id}`, () => {
      assert.equal(helpPagePath(`${prefix}/${id}`), `${prefix}/[id]`);
    });
  }
}

for (const path of [
  '/unknown', '/unknown/12345678-abcd-4abc-8abc-1234567890ab',
  '/me/notes/new', '/me/notes/not-a-uuid', '/admin/guides/abc123',
  '/me/notes/12345678-abcd-4abc-8abc-1234567890ab/edit',
  '/admin/guides/12345678-abcd-4abc-8abc-1234567890ab/extra',
  '/ME/NOTES/12345678-abcd-4abc-8abc-1234567890ab',
  '/me/notes/12345678-abcd-4abc-8abc-1234567890ag',
]) {
  test(`unsupported path is not guessed: ${path}`, () => {
    assert.equal(helpPagePath(path), path);
  });
}

test('unknown pathname remains null', () => assert.equal(helpPagePath(null), null));

test('HelpButton defers help until mount, then passes normalized and updated paths to the drawer', async () => {
  let pathname = '/me/notes/12345678-abcd-4abc-8abc-1234567890ab';
  let serverPath;
  const { default: Button } = load('src/components/help/HelpButton.tsx', {
    'next/navigation': { usePathname: () => pathname },
    '../ui/icons': { IcHelp: 'HelpIcon' },
    './HelpDrawer': { __esModule: true, default: props => {
      serverPath = props.pagePath;
      return React.createElement('fixture-drawer', props);
    } },
  });
  renderToString(React.createElement(Button));
  assert.equal(serverPath, null);
  let root;
  await React.act(async () => { root = Renderer.create(React.createElement(Button)); });
  assert.equal(root.root.findByType('fixture-drawer').props.pagePath, '/me/notes/[id]');
  await React.act(async () => root.root.findByType('button').props.onClick());
  assert.equal(root.root.findByType('fixture-drawer').props.open, true);
  pathname = '/ranking';
  await React.act(async () => root.update(React.createElement(Button)));
  assert.equal(root.root.findByType('fixture-drawer').props.pagePath, '/ranking');
  await React.act(async () => root.root.findByType('fixture-drawer').props.onClose());
  assert.equal(root.root.findByType('fixture-drawer').props.open, false);
  await React.act(async () => root.unmount());
});
