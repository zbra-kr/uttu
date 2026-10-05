const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), Renderer = require('react-test-renderer'), load = require('./helpers/load-source.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const row = (date, rank = 1, name = 'Brand') => ({ snapshot_date: date, rank_position: rank, brand_name: name, brands: { is_own: true } });
function fixture() {
    const calls = [], pending = [], listeners = new Set();
    let authLate = null, coreError = false;
    const client = { auth: { getUser: () => authLate?.promise ?? Promise.resolve({ data: { user: { id: 'A' } } }), onAuthStateChange: fn => { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; } }, from(table) {
            const call = { table, filters: [], limit: null };
            calls.push(call);
            const q = { select(fields, opts) { call.fields = fields; call.opts = opts; return q; }, eq(...args) { call.filters.push(args); return q; }, gte() { return q; }, lte() { return q; }, in() { return q; }, order() { return q; }, limit(n) { call.limit = n; return q; }, abortSignal(signal) { call.signal = signal; return q; }, then(yes, no) {
                    if (table === 'brand_ranking_snapshots') {
                        const d = deferred();
                        pending.push({ ...d, call });
                        return d.promise.then(yes, no);
                    }
                    let data = [];
                    if (table === 'brands')
                        data = [{ id: 'brand', name: 'Brand' }];
                    if (table === 'ranking_snapshots' && call.fields === 'snapshot_date') {
                        if (coreError)
                            return Promise.resolve({ data: null, error: { message: 'offline' } }).then(yes, no);
                        data = [{ snapshot_date: '2026-10-05' }];
                    }
                    ;
                    return Promise.resolve({ data, error: null, count: 0 }).then(yes, no);
                } };
            return q;
        } };
    const mocks = { '@/lib/supabase/client': { supabaseBrowser: () => client }, './supabase/client': { supabaseBrowser: () => client }, 'next/link': { __esModule: true, default: ({ children, ...p }) => React.createElement('a', p, children) }, '@/hooks/useResolvedViewport': { useResolvedViewport: () => 'desktop' } };
    return { client, calls, pending, mocks, auth(id) { listeners.forEach(fn => fn('SIGNED_IN', id ? { user: { id } } : null)); }, late() { authLate = deferred(); return authLate; }, failCore() { coreError = true; } };
}
test('actual source query uses independent available dates and bounded partial comparison', async () => { const f = fixture(), read = load('src/lib/report-brand-evidence.ts', f.mocks).fetchReportBrandEvidence; const p = read(new AbortController().signal); await Promise.resolve(); f.pending[0].resolve({ data: [row('2026-10-03', 2), row('2026-10-01', 5), row('2026-10-03', 3, 'Other')], error: null }); const value = await p; assert.equal(value.date, '2026-10-03'); assert.equal(value.comparisonDate, '2026-10-01'); assert.equal(value.rows[0].rankChange, 3); assert.equal(value.rows[1].rankChange, null); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].limit, 400); assert.ok(!f.calls[0].filters.some(([k]) => k === 'snapshot_date')); });
test('error, malformed missing dates, null data, genuine empty, and cap remain distinct', async () => {
    for (const response of [{ data: [], error: { message: 'offline' } }, { data: [{ rank_position: 1, brand_name: 'B' }], error: null }, { data: null, error: null }, { data: [], error: null }, { data: Array.from({ length: 400 }, (_, i) => row('2026-10-04', i + 1, 'B' + i)), error: null }]) {
        const f = fixture(), read = load('src/lib/report-brand-evidence.ts', f.mocks).fetchReportBrandEvidence, p = read(new AbortController().signal);
        await Promise.resolve();
        f.pending[0].resolve(response);
        if (response.error || response.data === null || response.data[0]?.snapshot_date === undefined && response.data.length)
            await assert.rejects(p);
        else {
            const value = await p;
            assert.equal(value.date, response.data.length ? '2026-10-04' : null);
            assert.equal(value.atLimit, response.data.length === 400);
        }
    }
});
test('real full desktop report preserves core on brand failure and total data query count', async () => {
    const f = fixture(), Page = load('src/app/(app)/report/page.tsx', f.mocks).default;
    let root;
    try {
        await React.act(async () => { root = Renderer.create(React.createElement(Page)); });
        assert.match(JSON.stringify(root.toJSON()), /MRR/);
        assert.match(JSON.stringify(root.toJSON()), /브랜드 순위 불러오는 중/);
        assert.equal(f.calls.length, 15);
        await React.act(async () => f.pending[0].resolve({ data: null, error: { message: 'offline' } }));
        assert.match(JSON.stringify(root.toJSON()), /빈 결과로 해석하지/);
        assert.match(JSON.stringify(root.toJSON()), /MRR/);
    }
    finally {
        await React.act(async () => root?.unmount());
    }
});
test('real report shows successful brand source despite core failure and stale dates explicitly', async () => {
    const f = fixture();
    f.failCore();
    const Page = load('src/app/(app)/report/page.tsx', f.mocks).default;
    let root;
    try {
        await React.act(async () => { root = Renderer.create(React.createElement(Page)); });
        await React.act(async () => f.pending[0].resolve({ data: [row('2026-10-03')], error: null }));
        assert.match(JSON.stringify(root.toJSON()), /리포트를 확인하지 못/);
        assert.match(JSON.stringify(root.toJSON()), /Brand/);
    }
    finally {
        await React.act(async () => root?.unmount());
    }
});
test('account changes reject out-of-order data; late auth lookup cannot restore signed-out report', async () => {
    const f = fixture(), late = f.late(), Page = load('src/app/(app)/report/page.tsx', f.mocks).default;
    let root;
    try {
        await React.act(async () => { root = Renderer.create(React.createElement(Page)); });
        assert.equal(f.calls.length, 0);
        await React.act(async () => f.auth('A'));
        await React.act(async () => f.auth('B'));
        assert.equal(f.pending[0].call.signal.aborted, true);
        await React.act(async () => { f.pending[1].resolve({ data: [row('2026-10-04', 1, 'Account B')], error: null }); f.pending[0].resolve({ data: [row('2026-10-04', 1, 'Private A')], error: null }); });
        assert.match(JSON.stringify(root.toJSON()), /Account B/);
        assert.doesNotMatch(JSON.stringify(root.toJSON()), /Private A/);
        const count = f.calls.length;
        await React.act(async () => f.auth('B'));
        assert.equal(f.calls.length, count);
        await React.act(async () => { f.auth(null); late.resolve({ data: { user: { id: 'A' } } }); });
        assert.doesNotMatch(JSON.stringify(root.toJSON()), /Account B|Private A/);
        assert.match(JSON.stringify(root.toJSON()), /로그인이 필요/);
    }
    finally {
        await React.act(async () => root?.unmount());
    }
});
test('full desktop/mobile report labels older source dates and authentic empty results', async () => {
    for (const mobile of [false, true]) {
        const f = fixture();
        f.mocks['@/hooks/useResolvedViewport'] = { useResolvedViewport: () => mobile ? 'mobile' : 'desktop' };
        const Page = load('src/app/(app)/report/page.tsx', f.mocks).default;
        let root;
        try {
            await React.act(async () => { root = Renderer.create(React.createElement(Page)); });
            await React.act(async () => f.pending[0].resolve({ data: [row('2026-10-03')], error: null }));
            assert.match(JSON.stringify(root.toJSON()), /2026-10-03/);
            assert.match(JSON.stringify(root.toJSON()), /보다 이전 자료/);
            assert.match(JSON.stringify(root.toJSON()), /전체 수집 완료 여부/);
            assert.equal(f.calls.length, 15);
        }
        finally {
            await React.act(async () => root?.unmount());
        }
    }
});
test('auth lookup failure is error rather than signed out or empty', async () => {
    const f = fixture(), late = f.late(), Page = load('src/app/(app)/report/page.tsx', f.mocks).default;
    let root;
    try {
        await React.act(async () => { root = Renderer.create(React.createElement(Page)); late.resolve({ data: { user: null }, error: { message: 'offline' } }); });
        assert.match(JSON.stringify(root.toJSON()), /리포트를 확인하지 못/);
        assert.doesNotMatch(JSON.stringify(root.toJSON()), /로그인이 필요|저장된 브랜드 순위가 없습니다/);
        assert.equal(f.calls.length, 0);
    }
    finally {
        await React.act(async () => root?.unmount());
    }
});
test('full report renders genuine empty brand result without failure text', async () => {
    const f = fixture(), Page = load('src/app/(app)/report/page.tsx', f.mocks).default;
    let root;
    try {
        await React.act(async () => { root = Renderer.create(React.createElement(Page)); });
        await React.act(async () => f.pending[0].resolve({ data: [], error: null }));
        assert.match(JSON.stringify(root.toJSON()), /저장된 브랜드 순위가 없습니다/);
        assert.doesNotMatch(JSON.stringify(root.toJSON()), /빈 결과로 해석하지/);
        assert.match(JSON.stringify(root.toJSON()), /MRR/);
    }
    finally {
        await React.act(async () => root?.unmount());
    }
});
test('brand-only retry keeps core and control, prevents duplicate pending requests', async () => {
    const f = fixture(), Page = load('src/app/(app)/report/page.tsx', f.mocks).default;
    let root;
    try {
        await React.act(async () => { root = Renderer.create(React.createElement(Page)); });
        await React.act(async () => f.pending[0].resolve({ data: null, error: { message: 'offline' } }));
        const button = root.root.findAllByProps({ 'aria-label': '브랜드 순위 다시 조회' })[0];
        await React.act(async () => button.props.onClick());
        assert.equal(f.calls.length, 16);
        assert.equal(button.props['aria-disabled'], true);
        await React.act(async () => button.props.onClick());
        assert.equal(f.calls.length, 16);
        assert.match(JSON.stringify(root.toJSON()), /MRR/);
        await React.act(async () => f.pending[1].resolve({ data: [row('2026-10-03')], error: null }));
        assert.equal(root.root.findAllByProps({ 'aria-label': '브랜드 순위 다시 조회' })[0], button);
        assert.match(JSON.stringify(root.toJSON()), /Brand/);
        assert.equal(button.props['aria-disabled'], false);
    }
    finally {
        await React.act(async () => root?.unmount());
    }
});
test('unresolved viewport mounts neither report data subtree', async () => { const f = fixture(); f.mocks['@/hooks/useResolvedViewport'] = { useResolvedViewport: () => null }; const Page = load('src/app/(app)/report/page.tsx', f.mocks).default; let root; try {
    await React.act(async () => { root = Renderer.create(React.createElement(Page)); });
    assert.equal(f.calls.length, 0);
    assert.match(JSON.stringify(root.toJSON()), /화면 준비 중/);
}
finally {
    await React.act(async () => root?.unmount());
} });
