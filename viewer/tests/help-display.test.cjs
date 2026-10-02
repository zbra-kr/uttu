// Run real component callbacks/effects with deterministic hooks. Not browser/DOM QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-source.cjs');

const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const article = (id, title = id) => ({ id, title, slug: id, content: doc(title) });

function drawer(initialProps = {}) {
  const previousWindow = global.window;
  global.window = { addEventListener() {}, removeEventListener() {} };
  const hooks = [], effects = [], requests = [];
  let cursor = 0, dirty = true, tree;
  let props = { open: true, pagePath: '/ranking', onClose() {}, ...initialProps };
  const React = {
    useState(initial) {
      const i = cursor++;
      if (!hooks[i]) hooks[i] = { value: initial };
      return [hooks[i].value, next => {
        const value = typeof next === 'function' ? next(hooks[i].value) : next;
        if (!Object.is(value, hooks[i].value)) { hooks[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!hooks[i]) hooks[i] = { current: initial };
      return hooks[i];
    },
    useEffect(callback, deps) {
      const i = cursor++;
      if (!hooks[i] || !sameDeps(hooks[i].deps, deps)) {
        const old = hooks[i];
        const next = hooks[i] = { deps };
        effects.push(() => { old?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const { default: Drawer } = load('src/components/help/HelpDrawer.tsx', {
    react: { __esModule: true, default: React },
    '@/lib/queries-help': { fetchHelpByPath: path => new Promise((resolve, reject) => requests.push({ path, resolve, reject })) },
    './TiptapRenderer': { __esModule: true, default: 'Renderer' },
    '@/components/onboarding/OnboardingProvider': { useOnboarding: () => ({ replay() {} }) },
    '@/hooks/useViewport': { useIsMobile: () => false },
  });
  function render() {
    let renders = 0;
    do {
      if (++renders > 20) throw new Error('Hook render loop');
      dirty = false; cursor = 0; tree = Drawer(props);
      while (effects.length) effects.shift()();
    } while (dirty);
    return tree;
  }
  async function flush() {
    for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty) render(); }
  }
  render();
  return {
    requests, flush,
    update(next) { props = { ...props, ...next }; return render(); },
    body: () => nodes(tree, node => node.type === 'Renderer')[0]?.props.content ?? null,
    select(title) {
      const tab = nodes(tree, node => node.type === 'button' && node.props.children === title)[0];
      assert.ok(tab, `Tab ${title} exists`); tab.props.onClick(); render();
    },
    dispose() {
      for (const hook of hooks) hook?.cleanup?.();
      if (previousWindow === undefined) delete global.window; else global.window = previousWindow;
    },
  };
}

test('drawer opens lazily, switches article tabs, and reuses the same-path result on reopen', async () => {
  const h = drawer({ open: false });
  try {
    assert.equal(h.requests.length, 0);
    h.update({ open: true });
    const first = article('first'), second = article('second');
    h.requests[0].resolve([first, second]); await h.flush();
    assert.deepEqual(h.body(), first.content);
    h.select('second'); assert.deepEqual(h.body(), second.content);
    h.select('first'); assert.deepEqual(h.body(), first.content);
    h.update({ open: false }); h.update({ open: true });
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.body(), first.content);
  } finally { h.dispose(); }
});

test('route changes hide the previous body and reset the selected tab', async () => {
  const h = drawer();
  try {
    h.requests[0].resolve([article('first'), article('second')]); await h.flush();
    h.select('second');
    h.update({ pagePath: '/brand' });
    assert.equal(h.body(), null);
    assert.equal(h.requests[1].path, '/brand');
    const next = article('brand');
    h.requests[1].resolve([next, article('brand-second')]); await h.flush();
    assert.deepEqual(h.body(), next.content);
  } finally { h.dispose(); }
});

test('a slower previous route request cannot replace the current page', async () => {
  const h = drawer();
  try {
    h.update({ pagePath: '/brand' });
    const current = article('brand');
    h.requests[1].resolve([current]); await h.flush();
    h.requests[0].resolve([article('stale')]); await h.flush();
    assert.deepEqual(h.body(), current.content);
  } finally { h.dispose(); }
});

test('a stale completion cannot stop the newer route loading or reveal old content', async () => {
  const h = drawer();
  try {
    h.update({ pagePath: '/brand' });
    h.requests[0].resolve([article('stale')]); await h.flush();
    assert.equal(h.body(), null);
    const current = article('brand');
    h.requests[1].resolve([current]); await h.flush();
    assert.deepEqual(h.body(), current.content);
  } finally { h.dispose(); }
});

test('returning to a cached route during another fetch restores its body', async () => {
  const h = drawer();
  try {
    const cached = article('ranking');
    h.requests[0].resolve([cached]); await h.flush();
    h.update({ pagePath: '/brand' });
    h.update({ pagePath: '/ranking' });
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.body(), cached.content);
    h.requests[1].resolve([article('late-brand')]); await h.flush();
    assert.deepEqual(h.body(), cached.content);
  } finally { h.dispose(); }
});

test('closing a pending drawer invalidates its request and reopening retries safely', async () => {
  const h = drawer();
  try {
    h.update({ open: false });
    h.update({ open: true });
    assert.equal(h.requests.length, 2);
    h.requests[0].resolve([article('stale')]); await h.flush();
    assert.equal(h.body(), null);
    const fresh = article('fresh');
    h.requests[1].resolve([fresh]); await h.flush();
    assert.deepEqual(h.body(), fresh.content);
  } finally { h.dispose(); }
});

test('null and article-free routes cannot retain another page body', async () => {
  const h = drawer();
  try {
    h.requests[0].resolve([article('ranking')]); await h.flush();
    h.update({ pagePath: null });
    assert.equal(h.body(), null); assert.equal(h.requests.length, 1);
    h.update({ pagePath: '/unknown' });
    h.requests[1].resolve([]); await h.flush();
    assert.equal(h.body(), null);
    h.update({ open: false }); h.update({ open: true });
    assert.equal(h.requests.length, 2);
  } finally { h.dispose(); }
});

test('Tiptap content changes reinitialize the readonly editor; same content does not', () => {
  let editor, previousDeps, creations = 0;
  const extension = { configure: () => ({}) };
  const mocks = {
    '@tiptap/react': {
      EditorContent: 'EditorContent',
      // Model useEditor's documented dependency-driven initialization contract.
      useEditor(options, deps = []) {
        if (!editor || !sameDeps(previousDeps, deps)) {
          editor = { content: options.content }; creations++;
        }
        previousDeps = deps;
        assert.equal(options.editable, false);
        assert.equal(options.immediatelyRender, false);
        return editor;
      },
    },
    lowlight: { createLowlight: () => ({}), common: {} },
  };
  for (const name of ['starter-kit', 'extension-image', 'extension-link', 'extension-table',
    'extension-table-row', 'extension-table-cell', 'extension-table-header',
    'extension-code-block-lowlight', 'extension-task-list', 'extension-task-item']) {
    mocks[`@tiptap/${name}`] = { __esModule: true, default: extension };
  }
  const { default: Renderer } = load('src/components/help/TiptapRenderer.tsx', mocks);
  const rendered = content => Renderer({ content }).props.children.props.editor.content;
  const first = doc('first article'), second = doc('second article'), updated = doc('updated same article');
  assert.deepEqual(rendered(first), first);
  assert.deepEqual(rendered(first), first); assert.equal(creations, 1);
  assert.deepEqual(rendered(second), second); assert.equal(creations, 2);
  assert.deepEqual(rendered(updated), updated); assert.equal(creations, 3);
  assert.deepEqual(rendered(first), first); assert.equal(creations, 4);
  assert.deepEqual(rendered(null), {}); assert.equal(creations, 5);
});
