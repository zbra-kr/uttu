const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const { renderMentionMessage } = load('src/lib/teams/message.ts');
const note = '33333333-3333-4333-8333-333333333333';
const input = () => ({ text: '@김은호 Hi\n다음 줄\n\n빈 줄', pageTitle: '상품 랭킹',
  origin: 'https://uttu.example.test', sourcePath: `/ranking?category=001&note=${note}` });

test('Teams HTML separates heading/body/link, preserving mention and line breaks', () => {
  assert.equal(renderMentionMessage(input()), `<p>[UTTU] 상품 랭킹에서 회원님을 멘션했습니다.</p><p>@김은호 Hi<br>다음 줄<br><br>빈 줄</p><p><a href="https://uttu.example.test/ranking?category=001&amp;note=${note}">UTTU에서 메모 보기 ↗</a></p>`);
});

test('all author text and database titles are literal escaped text', () => {
  const html = renderMentionMessage({ ...input(), text: '<img src=x onerror="alert(1)">&\'\r\n<at id="0">@이름</at>',
    pageTitle: '</p><script>alert(1)</script>\n제목' });
  assert.doesNotMatch(html, /<img|<script|<at|onerror="/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;&#39;<br>/);
  assert.match(html, /&lt;at id=&quot;0&quot;&gt;@이름&lt;\/at&gt;/);
  assert.match(html, /&lt;\/p&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; 제목/);
});

for (const [field, value] of [
  ['sourcePath', 'https://evil.example/phish'], ['sourcePath', '//evil.example/phish'],
  ['sourcePath', '/ranking\\evil'], ['sourcePath', '/auth/callback?next=evil'],
  ['sourcePath', '/product#fragment'], ['sourcePath', '/ranking\n?x=y'],
  ['origin', 'javascript:alert(1)'], ['origin', 'https://user:password@uttu.example.test'],
  ['origin', 'https://uttu.example.test/other'], ['origin', 'https://uttu.example.test?next=evil'],
  ['text', ' '], ['text', 'x'.repeat(4001)],
]) test(`invalid message ${field} ${String(value).slice(0, 45)} is rejected`, () => {
  assert.equal(renderMentionMessage({ ...input(), [field]: value }), null);
});

test('encoded payload cap keeps entities and emoji whole and retains labeled source link', () => {
  const html = renderMentionMessage({ ...input(), text: '😀'.repeat(4000), pageTitle: '긴 제목'.repeat(200) });
  assert.ok(html.includes('😀'.repeat(4000)));
  assert.ok(Buffer.byteLength(html) <= 24000);
  const escaped = renderMentionMessage({ ...input(), text: '"'.repeat(4000) });
  assert.ok(Buffer.byteLength(escaped) <= 24000);
  assert.match(escaped, /&quot;…<\/p><p><a href=/);
  assert.match(escaped, /UTTU에서 메모 보기 ↗<\/a><\/p>$/);
});
