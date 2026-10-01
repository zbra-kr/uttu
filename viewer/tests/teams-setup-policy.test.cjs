const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/teams/setup-policy.ts');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = new Module(filename, module);
mod._compile(compiled, filename);
const { evaluateTeamsAccess } = mod.exports;
const unavailable = { allowed: false, reason: 'unavailable' };

test('policy has no runtime dependencies, browser state, credentials or token operations', () => {
  assert.doesNotMatch(source, /(?:^|\n)\s*import\s|\b(?:Buffer|process|window|fetch|crypto)\b|server-only/);
});

for (const rpcData of [null, { status: 'connected' }, { status: 'reconnect_required' }]) {
  test(`server-only required flag off preserves current access: ${JSON.stringify(rpcData)}`, () => {
    assert.deepEqual(evaluateTeamsAccess({ enabled: false, verifiedRole: 'viewer', rpcData, rpcError: { message: 'unavailable' } }), { allowed: true, reason: 'disabled' });
  });
}

for (const rpcData of [null, {}, { status: 'setup_required' }, { status: 'identity_required' }, { status: 'reconnect_required' }]) {
  test(`independent protected admin role survives missing/error setup RPC: ${JSON.stringify(rpcData)}`, () => {
    assert.deepEqual(evaluateTeamsAccess({ enabled: true, verifiedRole: 'admin', rpcData, rpcError: new Error('RPC unavailable') }), { allowed: true, reason: 'admin_exempt' });
  });
}

for (const status of ['admin_exempt', 'connected']) {
  test(`trusted actor-bound RPC allows ${status}`, () => {
    assert.deepEqual(evaluateTeamsAccess({ enabled: true, rpcData: { status }, rpcError: null, connectionVerified: true }), { allowed: true, reason: status });
  });
}

for (const connectionVerified of [undefined, false, null, 'true', 1]) {
  test('metadata connected alone cannot bypass genuine encrypted-bundle verification', () => {
    assert.deepEqual(evaluateTeamsAccess({ enabled: true, rpcData: { status: 'connected' }, connectionVerified }), { allowed: false, reason: 'reconnect_required' });
  });
}

test('independent protected admin exception does not depend on Teams bundle verification', () => {
  assert.deepEqual(evaluateTeamsAccess({ enabled: true, verifiedRole: 'admin', rpcError: new Error('RPC unavailable'), connectionVerified: false }), { allowed: true, reason: 'admin_exempt' });
});

for (const status of ['setup_required', 'identity_required', 'reconnect_required']) {
  test(`non-admin ${status} fails closed`, () => {
    assert.deepEqual(evaluateTeamsAccess({ enabled: true, verifiedRole: 'viewer', rpcData: { status } }), { allowed: false, reason: status });
  });
}

for (const rpcData of [undefined, null, true, 'connected', [], [{ status: 'connected' }], {}, { status: 'unknown' }, { status: null }, Object.create({ status: 'connected' }), { get status() { throw new Error('malformed input'); } }]) {
  test('malformed or missing RPC result never permits non-admin access', () => {
    assert.deepEqual(evaluateTeamsAccess({ enabled: true, verifiedRole: 'viewer', rpcData }), unavailable);
  });
}

for (const rpcError of [new Error('unavailable'), {}, false, '', 0]) {
  test('any non-null RPC error overrides an otherwise connected response', () => {
    assert.deepEqual(evaluateTeamsAccess({ enabled: true, verifiedRole: 'viewer', rpcData: { status: 'connected' }, rpcError }), unavailable);
  });
}

for (const verifiedRole of [undefined, null, 'viewer', 'Admin', 'ADMIN', { role: 'admin' }, { user_metadata: { role: 'admin' } }, { app_metadata: { role: 'admin' } }]) {
  test('only exact independently verified DB admin role earns failure fallback', () => {
    assert.deepEqual(evaluateTeamsAccess({ enabled: true, verifiedRole, rpcData: null }), unavailable);
  });
}
