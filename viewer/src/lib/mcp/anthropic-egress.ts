import { NextRequest } from 'next/server';

/**
 * Anthropic Claude.ai 커넥터 발신 IP 대역.
 * 향후 대역 추가 시 이 배열에만 추가.
 * 출처: https://docs.anthropic.com/en/api/claude-ai-connector-ip-ranges
 */
const ANTHROPIC_EGRESS_CIDRS = [
  '160.79.104.0/21', // 160.79.104.0 – 160.79.111.255
] as const;

// ─── IPv4 CIDR 체크 ────────────────────────────────────────────────────────

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
  const network = cidr.slice(0, slash);
  const prefix = parseInt(cidr.slice(slash + 1), 10);
  // /0은 전체 허용 — 의도적 허용이 아니면 거부
  if (prefix === 0) return false;
  const mask = (~0 << (32 - prefix)) >>> 0;
  try {
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
  } catch {
    return false;
  }
}

// ─── IP 추출 ───────────────────────────────────────────────────────────────
//
// ⚠️  PENDING VERCEL VERIFICATION — 확정 전 변경 금지 ⚠️
//
// 현재 구현: x-forwarded-for 의 첫 번째(leftmost) 값을 클라이언트 IP로 간주.
// 근거(가정):
//   Vercel Edge 계층이 원본 클라이언트 IP를 x-forwarded-for 맨 앞에 추가하고,
//   그 뒤에 프록시 체인을 이어 붙인다고 가정.
//   Anthropic → Vercel 직접 호출 구조에서 첫 번째 값 = Anthropic IP.
//
// 검증 방법: 배포 후 /api/debug-ip 엔드포인트로 아래 두 curl 결과 비교:
//   (a) curl https://$DOMAIN/api/debug-ip
//   (b) curl -H "X-Forwarded-For: 160.79.104.1" https://$DOMAIN/api/debug-ip
//
// (b) 결과에서:
//   - x-forwarded-for = "160.79.104.1"           → XFF 완전 스푸핑 가능 → x-vercel-proxied-for 사용
//   - x-forwarded-for = "160.79.104.1, <realIP>" → Vercel이 append → 마지막 값 사용
//   - x-vercel-proxied-for 에 값이 있음           → 해당 헤더가 신뢰 소스
//
// 결과 확인 후 이 함수만 교체할 것. 호출 측 코드는 변경 불필요.
//
export function extractClientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (!xff) return null;
  const first = xff.split(',')[0].trim();
  return first || null;
}

// ─── 공개 API ──────────────────────────────────────────────────────────────

/** IPv6 주소이면 true. Anthropic 발신 대역은 IPv4 전용. */
export function isIPv6(ip: string): boolean {
  return ip.includes(':');
}

/**
 * req 의 클라이언트 IP가 Anthropic 발신 대역에 속하는지 검사.
 * IPv6 또는 추출 실패 시 false.
 */
export function isAnthropicEgress(req: NextRequest): boolean {
  const ip = extractClientIp(req);
  if (!ip) return false;
  if (isIPv6(ip)) return false;
  return ANTHROPIC_EGRESS_CIDRS.some(cidr => isInCidr(ip, cidr));
}
