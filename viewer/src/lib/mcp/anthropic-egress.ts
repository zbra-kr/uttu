import type { NextRequest } from 'next/server';

/**
 * Anthropic Claude.ai 커넥터 발신 IP 대역.
 * 출처: https://docs.anthropic.com/en/api/claude-ai-connector-ip-ranges
 *
 * 운영자 테스트용 오버라이드: 환경변수 MCP_ALLOWED_CIDRS (콤마 구분).
 * 예) MCP_ALLOWED_CIDRS="160.79.104.0/21,203.0.113.0/24"
 * Production 기본값에 0.0.0.0/0 · 사설대역 절대 추가 금지.
 */
const DEFAULT_CIDRS = ['160.79.104.0/21'] as const;

export function getAllowedCidrs(): string[] {
  const env = process.env.MCP_ALLOWED_CIDRS;
  if (env) return env.split(',').map(s => s.trim()).filter(Boolean);
  return [...DEFAULT_CIDRS];
}

// ─── IPv4 CIDR 수학 ────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error('not IPv4');
  return parts.reduce((acc, p) => {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0 || n > 255) throw new Error('invalid octet');
    return (acc << 8) | n;
  }, 0) >>> 0;
}

function isInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf('/');
  if (slash === -1) return false;
  const prefix = parseInt(cidr.slice(slash + 1), 10);
  if (prefix === 0) return false; // /0 전체허용 — 의도적이지 않으면 거부
  const mask = (~0 << (32 - prefix)) >>> 0;
  try {
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(cidr.slice(0, slash)) & mask);
  } catch {
    return false;
  }
}

// ─── 순수 함수 (exported — 테스트 가능) ───────────────────────────────────

/** IPv6 주소이면 true. Anthropic 발신 대역은 IPv4 전용. */
export function isIPv6(ip: string): boolean {
  return ip.includes(':');
}

/**
 * Vercel IP 헤더 우선순위 추출 (헤더 딕셔너리 인터페이스 — NextRequest 불필요).
 * 단위 테스트에서 plain object로 호출 가능.
 *
 * 우선순위: x-vercel-forwarded-for → x-forwarded-for
 *
 * 근거(2026-07-22 실측):
 *   Vercel 프로덕션에서 위조 헤더(X-Forwarded-For: 160.79.104.1)를 전송해도
 *   x-forwarded-for, x-real-ip, x-vercel-forwarded-for, x-vercel-proxied-for
 *   4개 헤더가 전부 실제 클라이언트 IP 단일값으로 도달.
 *   Vercel이 헤더를 완전히 덮어쓰는 것이 확인됨.
 *
 *   두 헤더는 현재 동일하나 Vercel 앞에 프록시를 두는 경우
 *   (B.CAVE는 현재 미사용, 향후 CDN 추가 가능)
 *   x-forwarded-for만 재작성될 수 있으므로 Vercel 전용 헤더를 우선한다.
 */
export function extractRawIpHeader(
  headers: { get(name: string): string | null },
): string | null {
  return headers.get('x-vercel-forwarded-for') ?? headers.get('x-forwarded-for') ?? null;
}

/**
 * 원시 헤더값을 검증·정제해 IP 문자열, 'malformed', null 중 하나를 반환.
 *
 * - null:        헤더 없음 또는 빈 값
 * - 'malformed': 콤마 포함 — Vercel은 항상 단일 IP를 설정(실측 확인).
 *                콤마 존재 = 비정상 경로(중간 프록시 재작성 등) = 신뢰 불가.
 * - string:      사용 가능한 단일 IP
 */
export function parseClientIp(raw: string | null): string | 'malformed' | null {
  if (!raw) return null;
  if (raw.includes(',')) return 'malformed';
  const trimmed = raw.trim();
  return trimmed || null;
}

/** IP가 허용 대역에 속하는지 여부만 반환 (단위 테스트용). */
export function checkIpAllowed(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return false;
  if (isIPv6(trimmed)) return false;
  return getAllowedCidrs().some(cidr => isInCidr(trimmed, cidr));
}

// ─── NextRequest 래퍼 ──────────────────────────────────────────────────────

export function extractClientIp(req: NextRequest): string | 'malformed' | null {
  return parseClientIp(extractRawIpHeader(req.headers));
}

export type EgressCheckResult =
  | { allowed: true;  ip: string }
  | { allowed: false; reason: 'no_ip_header' | 'ip_denied' | 'malformed_ip' };

/**
 * req 의 클라이언트 IP가 허용 대역에 속하는지 검사.
 * 결과에 ip(허용 시) 또는 reason(거부 시)을 포함해 호출 측 로깅에 활용.
 */
export function isAnthropicEgress(req: NextRequest): EgressCheckResult {
  const ip = extractClientIp(req);
  if (ip === null)       return { allowed: false, reason: 'no_ip_header' };
  if (ip === 'malformed') return { allowed: false, reason: 'malformed_ip' };
  if (!checkIpAllowed(ip)) return { allowed: false, reason: 'ip_denied' };
  return { allowed: true, ip };
}
