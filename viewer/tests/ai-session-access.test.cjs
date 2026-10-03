const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const { NextRequest } = require('next/server');
const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
function scenario(opts = {}) {
    let owner = opts.owner, providerCalls = 0, serviceClients = 0;
    const calls = [];
    const sb = { from(table) {
            return { op: 'read', filters: [], value: null,
                select() { return this; }, eq(k, v) { this.filters.push([k, v]); return this; }, gte() { return this; }, order() { return this; }, maybeSingle() { return this; },
                insert(v) { this.op = 'insert'; this.value = v; return this; }, update(v) { this.op = 'update'; this.value = v; return this; }, upsert(v) { this.op = 'upsert'; this.value = v; return this; },
                then(resolve, reject) {
                    return Promise.resolve().then(() => {
                        calls.push({ table, op: this.op, filters: this.filters, value: this.value });
                        if (table === 'ai_sessions') {
                            if (this.op === 'read') {
                                if (opts.readError)
                                    return { data: null, error: { message: 'offline' } };
                                return { data: owner === undefined || this.filters.some(([k, v]) => k === 'user_id' && owner !== v) ? null : { user_id: owner }, error: null };
                            }
                            if (this.op === 'insert') {
                                if (opts.insertError)
                                    return { error: { code: 'XX000' } };
                                if (opts.raceOwner !== undefined) {
                                    owner = opts.raceOwner;
                                    return { error: { code: '23505' } };
                                }
                                assert.equal(owner, undefined);
                                owner = this.value.user_id;
                            }
                        }
                        if (table === 'ai_messages' && this.op === 'read')
                            return { data: [{ role: 'user', content: 'owned history' }] };
                        return { data: null, error: null };
                    }).then(resolve, reject);
                } };
        } };
    class Anthropic {
        messages = { stream() { providerCalls++; return { on() { }, async finalMessage() { return { content: [], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: 'end_turn' }; } }; }, async create() { providerCalls++; return { content: [{ type: 'text', text: 'Title' }] }; } };
    }
    const mocks = { '@anthropic-ai/sdk': Anthropic, 'openai': class {
        }, '@google/generative-ai': { GoogleGenerativeAI: class {
            } },
        '@supabase/supabase-js': { createClient() { serviceClients++; return sb; } },
        '@supabase/ssr': { createServerClient: () => ({ auth: { async getUser() { if (opts.authThrows)
                        throw Error('auth unavailable'); return { data: { user: opts.noUser ? null : { id: userId } }, error: opts.authError ? { message: 'invalid' } : null }; } } }) },
        'next/headers': { cookies: () => ({ get: () => undefined }) }, '@/lib/ai/pipeline': { AI_QUERY_BLOCKED_TABLES: [], execQueryDb() { throw Error('unexpected tool'); } } };
    const chat = load('src/app/api/ai/chat/route.ts', mocks), messages = load('src/app/api/ai/messages/route.ts', mocks);
    const request = (patch = {}) => new NextRequest('https://uttu.example/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', text: 'hello' }], context: [], route: '/', sessionId, ...patch }) });
    return { chat, messages, request, calls, providerCalls: () => providerCalls, serviceClients: () => serviceClients };
}
for (const [label, options, status] of [
    ['foreign', { owner: otherId }, 403], ['null owner', { owner: null }, 403], ['no user', { noUser: true }, 401], ['auth throws', { authThrows: true }, 401], ['auth error with user', { authError: true }, 401], ['lookup error', { readError: true }, 503], ['insert error', { insertError: true }, 503]
])
    test(`chat fails closed: ${label}`, async () => { const s = scenario(options), res = await s.chat.POST(s.request()); assert.equal(res.status, status); assert.equal(s.providerCalls(), 0); assert.equal(s.calls.filter(c => c.table === 'ai_messages' || c.op === 'update').length, 0); if (status === 403 || status === 401)
        assert.equal(s.calls.filter(c => c.op !== 'read').length, 0); if (status === 401)
        assert.equal(s.serviceClients(), 0); });
for (const [label, options] of [['existing own', { owner: userId }], ['new own', {}], ['same-owner race', { raceOwner: userId }]])
    test(`chat preserves ${label}`, async () => { const s = scenario(options), res = await s.chat.POST(s.request()); assert.equal(res.status, 200); assert.match(await res.text(), /"type":"done"/); assert.equal(s.providerCalls(), 1); assert.equal(s.calls.filter(c => c.table === 'ai_messages' && c.op === 'insert').length, 2); for (const c of s.calls.filter(c => c.table === 'ai_sessions' && c.op === 'update'))
        assert.ok(c.filters.some(([k, v]) => k === 'user_id' && v === userId)); });
test('foreign insert race never receives messages or inference', async () => { const s = scenario({ raceOwner: otherId }), res = await s.chat.POST(s.request()); assert.equal(res.status, 403); assert.equal(s.providerCalls(), 0); assert.equal(s.calls.filter(c => c.table === 'ai_messages' || c.op === 'update').length, 0); });
for (const patch of [{ sessionId: 'bad' }, { messages: [] }, { messages: null }, { messages: [{ role: 'system', text: 'bad' }] }, { context: 'bad' }])
    test(`invalid request ${JSON.stringify(patch)}`, async () => { const s = scenario(), res = await s.chat.POST(s.request(patch)); assert.equal(res.status, 400); assert.equal(s.serviceClients(), 0); assert.equal(s.providerCalls(), 0); });
for (const options of [{ noUser: true }, { authThrows: true }, { authError: true }])
    test(`messages auth failure ${JSON.stringify(options)}`, async () => { const s = scenario(options), res = await s.messages.GET(new NextRequest(`https://uttu.example/api/ai/messages?sessionId=${sessionId}`)); assert.equal(res.status, 401); assert.equal(s.serviceClients(), 0); });
for (const owner of [userId, otherId])
    test(`messages ownership ${owner}`, async () => { const s = scenario({ owner }), res = await s.messages.GET(new NextRequest(`https://uttu.example/api/ai/messages?sessionId=${sessionId}`)); assert.equal((await res.json()).messages.length, owner === userId ? 1 : 0); assert.equal(s.calls.filter(c => c.table === 'ai_messages').length, owner === userId ? 1 : 0); });
