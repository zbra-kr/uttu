const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadSource(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
  });
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name);
  mod._compile(outputText, filename);
  return mod.exports;
}

const identity = loadSource('src/lib/teams/identity.ts');
const message = loadSource('src/lib/teams/message.ts');
const graph = loadSource('src/lib/teams/graph.ts', { './identity': identity, './message': message, 'server-only': {} });
const tenant = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const authorOid = '33333333-3333-4333-8333-333333333333';
const recipientId = '44444444-4444-4444-8444-444444444444';
const recipientOid = '55555555-5555-4555-8555-555555555555';
const deliveryId = '66666666-6666-4666-8666-666666666666';
const now = 1_800_000_000_000;

function azureUser() {
  return { id: userId, identities: [{ provider: 'azure', identity_data: {
    iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
    sub: 'app-specific-pairwise-subject', provider_id: 'not-the-object-id',
    custom_claims: { tid: tenant, oid: authorOid },
  } }] };
}

test('verified Azure custom claims supply stable tenant/object identity', () => {
  assert.deepEqual(identity.microsoftIdentity(azureUser(), tenant), {
    userId, tenantId: tenant, objectId: authorOid,
  });
});

test('UPN/email/name change does not change the mapped identity', () => {
  const user = azureUser();
  user.identities[0].identity_data.email = 'before@example.test';
  const before = identity.microsoftIdentity(user, tenant);
  user.identities[0].identity_data.email = 'after@example.test';
  user.identities[0].identity_data.preferred_username = 'new-upn@example.test';
  user.identities[0].identity_data.full_name = '새 이름';
  assert.deepEqual(identity.microsoftIdentity(user, tenant), before);
});

for (const [label, mutate] of [
  ['no Azure identity', u => { u.identities = []; }],
  ['email provider', u => { u.identities[0].provider = 'email'; }],
  ['duplicate Azure identities', u => { u.identities.push(u.identities[0]); }],
  ['missing oid', u => { delete u.identities[0].identity_data.custom_claims.oid; }],
  ['missing tenant', u => { delete u.identities[0].identity_data.custom_claims.tid; }],
  ['non-GUID oid', u => { u.identities[0].identity_data.custom_claims.oid = "x')/messages"; }],
  ['another tenant', u => { u.identities[0].identity_data.custom_claims.tid = recipientId; }],
  ['untrusted issuer', u => { u.identities[0].identity_data.iss = 'https://evil.example'; }],
  ['common issuer', u => { u.identities[0].identity_data.iss = 'https://login.microsoftonline.com/common/v2.0'; }],
  ['top-level user metadata spoof', u => { u.user_metadata = u.identities[0].identity_data; u.identities = []; }],
  ['sub is not oid', u => { delete u.identities[0].identity_data.custom_claims; }],
]) {
  test(`identity fails closed: ${label}`, () => {
    const user = azureUser(); mutate(user);
    assert.equal(identity.microsoftIdentity(user, tenant), null);
  });
}

function input() {
  const author = { userId, tenantId: tenant, objectId: authorOid };
  return {
    enabled: true, authorActionConfirmed: true, deliveryId,
    authorizeMessage: async () => true,
    authenticatedAuthor: author,
    recipient: { userId: recipientId, tenantId: tenant, objectId: recipientOid },
    grant: { identity: author, accessToken: 'mock-opaque-access-token',
      scopes: ['Chat.Create', 'ChatMessage.Send'], expiresAt: now + 3600_000, consented: true },
    text: '@사람 확인 부탁드립니다.', pageTitle: '상품 랭킹',
    origin: 'https://uttu.example.test', sourcePath: `/me/notes/${deliveryId}`,
  };
}

const noNetwork = async () => assert.fail('This case must never contact Graph');

for (const [label, mutate, status] of [
  ['feature disabled', x => { x.enabled = false; }, 'not_sent'],
  ['unconfirmed author action', x => { x.authorActionConfirmed = false; }, 'not_sent'],
  ['invalid delivery id', x => { x.deliveryId = 'anything'; }, 'not_sent'],
  ['invalid author', x => { x.authenticatedAuthor.userId = 'anything'; }, 'not_sent'],
  ['different recipient tenant', x => { x.recipient.tenantId = recipientId; }, 'not_sent'],
  ['self mention', x => { x.recipient = x.authenticatedAuthor; }, 'not_sent'],
  ['aliased same recipient object', x => { x.recipient.objectId = authorOid; }, 'not_sent'],
  ['invalid recipient oid', x => { x.recipient.objectId = 'email@example.test'; }, 'not_sent'],
  ['missing grant', x => { x.grant = null; }, 'reconnect_required'],
  ['missing Teams consent', x => { x.grant.consented = false; }, 'reconnect_required'],
  ['wrong sender token binding', x => { x.grant.identity = x.recipient; }, 'reconnect_required'],
  ['no send permission', x => { x.grant.scopes = ['Chat.Create']; }, 'reconnect_required'],
  ['no create permission', x => { x.grant.scopes = ['ChatMessage.Send']; }, 'reconnect_required'],
  ['only broad read/write scope', x => { x.grant.scopes = ['Chat.ReadWrite']; }, 'reconnect_required'],
  ['expired token', x => { x.grant.expiresAt = now - 1; }, 'reconnect_required'],
  ['token about to expire', x => { x.grant.expiresAt = now + 20_000; }, 'reconnect_required'],
  ['unknown expiry', x => { x.grant.expiresAt = NaN; }, 'reconnect_required'],
  ['token header injection', x => { x.grant.accessToken = 'token\r\nX-Evil: hi'; }, 'reconnect_required'],
  ['empty text', x => { x.text = '  '; }, 'not_sent'],
  ['oversized text', x => { x.text = 'x'.repeat(6001); }, 'not_sent'],
]) {
  test(`sending fails closed: ${label}`, async () => {
    const value = input(); mutate(value);
    assert.equal((await graph.sendAuthorMention(value, noNetwork, now)).status, status);
  });
}

test('only two delegated POSTs, exact IDs, escaped HTML and no spoofed from field', async () => {
  const calls = [];
  const value = input();
  value.grant.scopes = ['https://graph.microsoft.com/Chat.Create', 'https://graph.microsoft.com/ChatMessage.Send'];
  value.text = '<script>alert("literal text")</script>';
  const result = await graph.sendAuthorMention(value, async (url, init) => {
    calls.push([url, init]);
    return Response.json({ id: calls.length === 1 ? '19:a/b?x@y' : 'message-123' }, { status: 201 });
  }, now);
  assert.deepEqual(result, { status: 'sent', chatId: '19:a/b?x@y', messageId: 'message-123' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'https://graph.microsoft.com/v1.0/chats');
  assert.equal(calls[1][0], 'https://graph.microsoft.com/v1.0/chats/19%3Aa%2Fb%3Fx%40y/messages');
  const create = JSON.parse(calls[0][1].body);
  assert.equal(create.chatType, 'oneOnOne');
  assert.deepEqual(create.members.map(m => m['user@odata.bind']), [
    `https://graph.microsoft.com/v1.0/users('${authorOid}')`,
    `https://graph.microsoft.com/v1.0/users('${recipientOid}')`,
  ]);
  assert.deepEqual(JSON.parse(calls[1][1].body), {
    body: { contentType: 'html', content: message.renderMentionMessage(value) },
  });
  assert.doesNotMatch(JSON.parse(calls[1][1].body).body.content, /<script>/);
  assert.match(JSON.parse(calls[1][1].body).body.content, /&lt;script&gt;/);
  for (const [, init] of calls) {
    assert.equal(init.headers.Authorization, 'Bearer mock-opaque-access-token');
    assert.equal(init.headers['client-request-id'], deliveryId);
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
  }
});

for (const status of [401, 403, 404, 429, 500, 502]) {
  test(`chat HTTP ${status} never attempts a message`, async () => {
    let calls = 0;
    const result = await graph.sendAuthorMention(input(), async () => {
      calls++;
      return Response.json({ error: { message: 'private provider error' } }, {
        status, headers: { 'Retry-After': '123' },
      });
    }, now);
    assert.equal(calls, 1);
    assert.equal(result.status, [401, 403].includes(status) ? 'reconnect_required' : status === 429 ? 'throttled' : 'failed');
    if (status === 429) assert.equal(result.retryAfterSeconds, 123);
    assert.doesNotMatch(JSON.stringify(result), /private provider error/);
  });
}

for (const [kind, expected] of [
  ['timeout', 'unknown'], ['500', 'unknown'], ['502', 'unknown'], ['bad-json', 'unknown'],
  ['missing-id', 'unknown'], ['401', 'reconnect_required'], ['403', 'reconnect_required'],
  ['400', 'failed'], ['429', 'throttled'],
]) {
  test(`message ${kind} does not retry or falsely claim success`, async () => {
    let calls = 0;
    const result = await graph.sendAuthorMention(input(), async () => {
      calls++;
      if (calls === 1) return Response.json({ id: 'chat-123' }, { status: 201 });
      if (kind === 'timeout') throw new Error('private-message-and-token');
      if (kind === 'bad-json') return new Response('not JSON', { status: 201 });
      if (kind === 'missing-id') return Response.json({}, { status: 201 });
      return Response.json({ error: { message: 'private-message-and-token' } }, {
        status: Number(kind), headers: { 'Retry-After': '30' },
      });
    }, now);
    assert.equal(calls, 2);
    assert.equal(result.status, expected);
    assert.doesNotMatch(JSON.stringify(result), /private-message-and-token/);
  });
}

test('chat network failure never reaches message stage', async () => {
  let calls = 0;
  assert.deepEqual(await graph.sendAuthorMention(input(), async () => {
    calls++; throw new Error('private');
  }, now), { status: 'failed', phase: 'chat' });
  assert.equal(calls, 1);
});

test('HTTP-date Retry-After is respected', async () => {
  const result = await graph.sendAuthorMention(input(), async () => Response.json({}, {
    status: 429, headers: { 'Retry-After': new Date(now + 120_000).toUTCString() },
  }), now);
  assert.equal(result.retryAfterSeconds, 120);
});

for (const kind of ['disconnect', 'note-edited', 'recipient-removed', 'database-error']) {
  test(`send boundary rejects ${kind} after chat creation but before message`, async () => {
    let calls = 0;
    const value = input();
    value.authorizeMessage = async () => {
      assert.equal(calls, 1);
      if (kind === 'database-error') throw new Error('private database details');
      return false;
    };
    const result = await graph.sendAuthorMention(value, async () => {
      calls++;
      assert.equal(calls, 1, 'Must not send a message after authorization changed');
      return Response.json({ id: 'chat' }, { status: 201 });
    }, now);
    assert.deepEqual(result, { status: 'not_sent', reason: 'not_authorized' });
    assert.equal(calls, 1);
  });
}

test('normal sign-in never adds Teams scopes or handles Teams tokens', () => {
  for (const file of ['src/app/auth/microsoft.ts', 'src/app/auth/callback/route.ts',
    'src/lib/auth/oauth.ts']) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /sendAuthorMention|Chat\.Create|ChatMessage\.Send|offline_access/);
  }
});

const mentions = loadSource('src/lib/teams/mentions.ts');
const selected = { key: recipientId, label: '정호철', userIds: [recipientId], start: 3, end: 7 };
for (const [label, after, expected] of [
  ['unchanged', '안녕 @정호철 내용', [{ ...selected }]],
  ['prefix insertion', '추가 안녕 @정호철 내용', [{ ...selected, start: 6, end: 10 }]],
  ['suffix edit', '안녕 @정호철 다른 내용', [{ ...selected }]],
  ['remove token', '안녕 내용', []],
  ['edit token', '안녕 @정호천 내용', []],
  ['extend token', '안녕 @정호철님 내용', []],
  ['remove at-sign', '안녕 정호철 내용', []],
  ['empty', '', []],
]) {
  test(`selected mention ranges: ${label}`, () => {
    assert.deepEqual(mentions.moveMentionRanges('안녕 @정호철 내용', after, [selected]), expected);
  });
}

test('selected recipients deduplicate by UUID and exclude author', () => {
  assert.deepEqual(mentions.selectedMentionIds([
    { ...selected, userIds: [recipientId, userId] }, { ...selected },
  ], userId), [recipientId]);
});

test('editing an ambiguous duplicate label drops both UUID selections rather than guessing', () => {
  const first = { key: userId, label: '동명', userIds: [userId], start: 0, end: 3 };
  const second = { key: recipientId, label: '동명', userIds: [recipientId], start: 4, end: 7 };
  assert.deepEqual(mentions.moveMentionRanges('@동명 @동명', ' @동명', [first, second]), []);
  assert.deepEqual(mentions.moveMentionRanges('@동명 @동명', '@동명', [first, second]), []);
  assert.deepEqual(mentions.moveMentionRanges('@동명 @동명', '@동명 ', [first, second]), []);
  assert.deepEqual(mentions.moveMentionRanges('@동명 @동명', '@동명', [first]), []);
  assert.deepEqual(mentions.moveMentionRanges('@동명 @동명', '@동명', [second]), []);
});

test('malicious Retry-After never becomes Infinity or an invalid date', async () => {
  for (const value of ['9'.repeat(400), '999999999999', 'Fri, 01 Jan 9999 00:00:00 GMT']) {
    const result = await graph.sendAuthorMention(input(), async () => Response.json({}, {
      status: 429, headers: { 'Retry-After': value },
    }), now);
    assert.ok(Number.isFinite(result.retryAfterSeconds));
    assert.ok(result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 86400);
    assert.doesNotThrow(() => new Date(now + result.retryAfterSeconds * 1000).toISOString());
  }
});
