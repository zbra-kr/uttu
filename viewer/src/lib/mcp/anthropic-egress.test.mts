/**
 * anthropic-egress 단위 테스트
 * 실행: node --experimental-strip-types src/lib/mcp/anthropic-egress.test.mts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkIpAllowed,
  parseClientIp,
  extractRawIpHeader,
  isIPv6,
  getAllowedCidrs,
} from './anthropic-egress.ts';

// ─── 160.79.104.0/21 대역 경계값 ─────────────────────────────────────────

describe('checkIpAllowed — 기본 대역 160.79.104.0/21', () => {
  test('대역 하한 160.79.104.0 → allow', () => {
    assert.equal(checkIpAllowed('160.79.104.0'), true);
  });

  test('대역 상한 160.79.111.255 → allow', () => {
    assert.equal(checkIpAllowed('160.79.111.255'), true);
  });

  test('중간값 160.79.108.42 → allow', () => {
    assert.equal(checkIpAllowed('160.79.108.42'), true);
  });

  test('하한 -1: 160.79.103.255 → deny', () => {
    assert.equal(checkIpAllowed('160.79.103.255'), false);
  });

  test('상한 +1: 160.79.112.0 → deny', () => {
    assert.equal(checkIpAllowed('160.79.112.0'), false);
  });
});

// ─── IPv6 ──────────────────────────────────────────────────────────────────

describe('checkIpAllowed — IPv6 거부', () => {
  test('::1 → deny', () => {
    assert.equal(checkIpAllowed('::1'), false);
  });

  test('2001:db8::1 → deny', () => {
    assert.equal(checkIpAllowed('2001:db8::1'), false);
  });
});

// ─── 빈 값·공백 ────────────────────────────────────────────────────────────

describe('checkIpAllowed — 빈 값·공백', () => {
  test("'' → deny", () => {
    assert.equal(checkIpAllowed(''), false);
  });

  test("'   ' → deny", () => {
    assert.equal(checkIpAllowed('   '), false);
  });
});

// ─── isIPv6 ────────────────────────────────────────────────────────────────

describe('isIPv6', () => {
  test('::1 → true', () => assert.equal(isIPv6('::1'), true));
  test('160.79.104.1 → false', () => assert.equal(isIPv6('160.79.104.1'), false));
});

// ─── parseClientIp ─────────────────────────────────────────────────────────
// 2026-07-22 실측: Vercel은 항상 단일 IP를 설정.
// 콤마가 있으면 비정상 경로 → 'malformed' 반환.

describe('parseClientIp', () => {
  test('단일 IP → 그 값 반환', () => {
    assert.equal(parseClientIp('160.79.104.1'), '160.79.104.1');
  });

  test('[7-1] 콤마 구분 다중값 → malformed (Vercel 실측: 단일 IP만 가능)', () => {
    assert.equal(parseClientIp('160.79.104.1, 1.2.3.4'), 'malformed');
  });

  test('콤마 구분 — 정상 IP처럼 보여도 malformed', () => {
    assert.equal(parseClientIp('160.79.104.0,160.79.104.1'), 'malformed');
  });

  test('앞뒤 공백은 허용 (trim)', () => {
    assert.equal(parseClientIp('  160.79.104.1  '), '160.79.104.1');
  });

  test('null 입력 → null', () => {
    assert.equal(parseClientIp(null), null);
  });

  test('빈 문자열 → null', () => {
    assert.equal(parseClientIp(''), null);
  });
});

// ─── extractRawIpHeader — 헤더 우선순위 ──────────────────────────────────
// [7-2] x-vercel-forwarded-for 우선

describe('extractRawIpHeader — 우선순위: x-vercel-forwarded-for > x-forwarded-for', () => {
  const headers = (map: Record<string, string>) => ({
    get: (name: string) => map[name] ?? null,
  });

  test('x-vercel-forwarded-for만 있을 때 → 해당 값', () => {
    const h = headers({ 'x-vercel-forwarded-for': '160.79.104.1' });
    assert.equal(extractRawIpHeader(h), '160.79.104.1');
  });

  test('x-forwarded-for만 있을 때 → 해당 값', () => {
    const h = headers({ 'x-forwarded-for': '160.79.104.2' });
    assert.equal(extractRawIpHeader(h), '160.79.104.2');
  });

  test('[7-2] 둘 다 있을 때 → x-vercel-forwarded-for 우선', () => {
    const h = headers({
      'x-vercel-forwarded-for': '160.79.104.1',
      'x-forwarded-for':        '1.2.3.4',
    });
    assert.equal(extractRawIpHeader(h), '160.79.104.1');
  });

  test('[7-3] 두 헤더 모두 없을 때 → null', () => {
    const h = headers({});
    assert.equal(extractRawIpHeader(h), null);
  });
});

// ─── MCP_ALLOWED_CIDRS 환경변수 오버라이드 ────────────────────────────────

describe('MCP_ALLOWED_CIDRS 환경변수 오버라이드', () => {
  test('기본값 — 환경변수 없으면 160.79.104.0/21', () => {
    const orig = process.env.MCP_ALLOWED_CIDRS;
    delete process.env.MCP_ALLOWED_CIDRS;
    assert.deepEqual(getAllowedCidrs(), ['160.79.104.0/21']);
    if (orig !== undefined) process.env.MCP_ALLOWED_CIDRS = orig;
  });

  test('오버라이드 — 설정된 CIDR 반환', () => {
    process.env.MCP_ALLOWED_CIDRS = '203.0.113.0/24, 198.51.100.0/24';
    assert.deepEqual(getAllowedCidrs(), ['203.0.113.0/24', '198.51.100.0/24']);
    delete process.env.MCP_ALLOWED_CIDRS;
  });

  test('오버라이드 CIDR — checkIpAllowed 반영', () => {
    process.env.MCP_ALLOWED_CIDRS = '203.0.113.0/24';
    assert.equal(checkIpAllowed('203.0.113.1'), true);
    assert.equal(checkIpAllowed('160.79.104.1'), false); // 기본 대역은 제외됨
    delete process.env.MCP_ALLOWED_CIDRS;
  });
});
