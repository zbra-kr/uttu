const React = require('react'), Renderer = require('react-test-renderer');
const { createClient } = require('@supabase/supabase-js');
const load = require('./load-source.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React, flush = () => new Promise(resolve => setImmediate(resolve));
const row = gender => ({ id: 'fixture-' + gender, title: 'POPULATED-' + gender, module_type: 'STD',
  gender_filter: gender, position: 1, snapshot_date: '2026-10-05', items_count: 7 });
async function fixture(options = {}) {
  const calls = [], held = [], writes = []; let hold = false, failTransport = false;
  const client = createClient('https://fixture.invalid', 'fixture-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname !== '/rest/v1/recommend_modules') throw new Error('Unexpected fixture endpoint');
      // Existing in-flight requests may ignore abort, but a fresh pre-aborted fetch cannot dispatch.
      if (init.signal?.aborted) throw new DOMException('fixture aborted', 'AbortError');
      if (failTransport) throw new Error('fixture transport failure');
      return new Promise((resolve, reject) => {
        const call = { gender: url.searchParams.get('gender_filter').slice(3), params: [...url.searchParams],
          signal: init.signal, resolve, reject };
        calls.push(call);
        if (options.respectAbort) call.signal?.addEventListener('abort', () => reject(new DOMException('fixture aborted', 'AbortError')), { once: true });
      });
    } },
  });
  const react = { ...React, useState(initial) {
    const [value, set] = React.useState(initial), setter = React.useRef();
    if (!setter.current) setter.current = next => { writes.push(next); set(next); };
    return [value, setter.current];
  }, useEffect(effect, deps) {
    return React.useEffect(() => {
      if (!hold) return effect();
      const pending = { run: effect, cancelled: false }; held.push(pending);
      return () => { pending.cancelled = true; pending.cleanup?.(); };
    }, deps);
  } };
  const chart = ({ children, data }) => React.createElement('div', Array.isArray(data) ? { 'data-fixture-chart': JSON.stringify(data) } : null, children);
  const Component = load('src/app/(app)/recommend/MobileRecommendView.tsx', {
    react, '@/lib/supabase/client': { supabaseBrowser: () => client },
    recharts: Object.fromEntries(['LineChart', 'Line', 'XAxis', 'YAxis', 'ResponsiveContainer', 'Tooltip'].map(name => [name, chart])),
  }).default;
  let root;
  await act(async () => { root = Renderer.create(options.strict ? React.createElement(React.StrictMode, null, React.createElement(Component)) : React.createElement(Component)); await flush(); });
  const settle = async (index, rows, error = false) => act(async () => {
    calls[index].resolve(new Response(JSON.stringify(error ? { message: 'fixture SDK failure', code: 'FIXTURE', details: null, hint: null } : rows),
      { status: error ? 400 : 200, headers: { 'Content-Type': 'application/json' } })); await flush();
  });
  const reject = async index => act(async () => { calls[index].reject(new Error('fixture transport failure')); await flush(); });
  const select = async gender => act(async () => {
    root.root.find(instance => instance.type.name === 'MobileFilterChips').props.onChange(gender); await flush();
  });
  const retry = () => root.root.findAllByType('button').find(button => button.children.join('') === '다시 시도')?.props.onClick;
  const invoke = async (...handlers) => act(async () => { handlers.forEach(handler => handler()); await flush(); });
  const snapshot = () => ({ gender: root.root.find(instance => instance.type.name === 'MobileFilterChips').props.activeValue,
    tree: JSON.stringify(root.toJSON()), alerts: root.root.findAllByProps({ role: 'alert' }).length,
    empty: root.root.findAll(instance => instance.type.name === 'MobileEmptyState').length,
    kpis: ['조회한 모듈 스냅샷', '조회분 상품 항목 합계'].map(label => {
      const node = root.root.findAllByType('div').find(instance => instance.children.length === 1 && instance.children[0] === label);
      return node.parent.children[0].children.join('');
    }),
    charts: root.root.findAll(instance => instance.props['data-fixture-chart']).map(instance => JSON.parse(instance.props['data-fixture-chart'])) });
  const close = async () => act(async () => { root.unmount(); await flush(); });
  const releaseEffects = async () => act(async () => { hold = false; for (const effect of held.splice(0)) if (!effect.cancelled) effect.cleanup = effect.run(); await flush(); });
  const waitForError = async () => act(async () => {
    const deadline = Date.now() + 15000;
    while (!writes.some(value => value?.status === 'error')) {
      if (Date.now() > deadline) throw new Error('SDK error did not settle');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await flush();
  });
  return { calls, writes, waitForError, failTransport: value => { failTransport = value; }, settle, reject, select, retry, invoke, snapshot, close, row, holdEffects: () => { hold = true; }, releaseEffects };
}
module.exports = { fixture, row };
