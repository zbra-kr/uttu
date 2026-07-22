import { timingSafeEqual, createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { isAnthropicEgress } from '@/lib/mcp/anthropic-egress';
import { createUttuMcpHandler } from '@/lib/mcp/handler';

// ─── 상수 ──────────────────────────────────────────────────────────────────

const NOT_FOUND = new Response(null, { status: 404 });

// ─── Secret 검증 (timing-safe) ─────────────────────────────────────────────

function verifyGatewaySecret(incoming: string): boolean {
  const expected = process.env.MCP_GATEWAY_SECRET ?? '';
  if (!expected) return false;
  // 길이가 다르면 timingSafeEqual이 throw하므로 먼저 체크
  if (incoming.length !== expected.length) return false;
  return timingSafeEqual(
    Buffer.from(incoming, 'utf8'),
    Buffer.from(expected, 'utf8'),
  );
}

// ─── 거부 로깅 (IP·경로 8자리 해시만, 전체 값 로깅 금지) ──────────────────

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function logRejection(reason: 'secret' | 'ip', req: NextRequest, gateway: string): void {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  console.warn(
    `[mcp-gateway] reject reason=${reason}` +
    ` ip_hash=${shortHash(ip)}` +
    ` path_hash=${shortHash(`/api/mcp/${gateway}`)}`,
  );
}

// ─── MCP 핸들러 (lazy init — env var은 cold start 후 확정) ─────────────────

let _handler: ReturnType<typeof createUttuMcpHandler> | null = null;

function getHandler(): ReturnType<typeof createUttuMcpHandler> {
  if (!_handler) {
    const secret = process.env.MCP_GATEWAY_SECRET;
    if (!secret) throw new Error('MCP_GATEWAY_SECRET 미설정');
    _handler = createUttuMcpHandler(`/api/mcp/${secret}`);
  }
  return _handler;
}

// ─── 라우트 핸들러 ─────────────────────────────────────────────────────────

async function handler(
  req: NextRequest,
  { params }: { params: { gateway: string } },
): Promise<Response> {
  const { gateway } = params;

  // 1. secret 검증 — 불일치 시 404 (경로 존재 자체를 숨김)
  if (!verifyGatewaySecret(gateway)) {
    logRejection('secret', req, gateway);
    return NOT_FOUND;
  }

  // 2. IP 대역 검증 — 불일치 시 404
  if (!isAnthropicEgress(req)) {
    logRejection('ip', req, gateway);
    return NOT_FOUND;
  }

  // 3. MCP 처리
  return getHandler()(req);
}

export { handler as GET, handler as POST };
