const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const id = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
class Redirect extends Error {}
class NotFound extends Error {}
function page(denied = false) {
  const calls = [];
  const sb = { from: table => { calls.push(table); return { select: () => ({ eq: () => ({
    single: async () => ({ data: denied ? null : { id, body: '@수신자 메모', user_id: id,
      entity_type: 'product', entity_id: productId } }),
    maybeSingle: async () => ({ data: table === 'products'
      ? { name: '상품', musinsa_no: 12345 } : { display_name: '작성자' } }),
  }) }) }; } };
  return { calls, render: load('src/app/(app)/me/notes/[id]/page.tsx', {
    '@/lib/supabase/server': { supabaseServer: async () => sb },
    'next/navigation': { notFound: () => { throw new NotFound(); }, redirect: url => { throw new Redirect(url); } },
  }).default };
}

test('existing memo permalink resolves to its canonical product source after RLS read', async () => {
  const p = page();
  await assert.rejects(p.render({ params: { id } }), error => error instanceof Redirect
    && error.message.includes('/product?') && error.message.includes(`note=${id}`) && error.message.includes('no=12345'));
  assert.deepEqual(p.calls, ['user_notes', 'products']);
});

test('forced memo fallback is a real escape from a failed source detail and does not redirect again', async () => {
  const p = page();
  const output = await p.render({ params: { id }, searchParams: { view: 'memo' } });
  assert.equal(output.type, 'section');
  assert.ok(output.props.children.some(child => child?.type === 'div' && child.props.children === '@수신자 메모'));
  assert.deepEqual(p.calls, ['user_notes', 'products', 'profiles_public']);
});

test('unrelated or deleted memo stays unavailable even through forced memo mode', async () => {
  for (const searchParams of [undefined, { view: 'memo' }]) {
    const p = page(true);
    await assert.rejects(p.render({ params: { id }, searchParams }), NotFound);
    assert.deepEqual(p.calls, ['user_notes']);
  }
});
