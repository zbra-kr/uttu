const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');
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

test('HelpButton passes the normalized pathname to the drawer', () => {
  const { default: Button } = load('src/components/help/HelpButton.tsx', {
    react: { useState: () => [false, () => {}] },
    'next/navigation': { usePathname: () => '/me/notes/12345678-abcd-4abc-8abc-1234567890ab' },
    '../ui/icons': { IcHelp: 'HelpIcon' },
    './HelpDrawer': { __esModule: true, default: 'Drawer' },
  });
  assert.equal(Button().props.children.find(node => node.type === 'Drawer').props.pagePath, '/me/notes/[id]');
});
