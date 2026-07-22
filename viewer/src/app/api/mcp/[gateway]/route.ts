import { timingSafeEqual, createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { isAnthropicEgress } from '@/lib/mcp/anthropic-egress';
import { createUttuMcpHandler } from '@/lib/mcp/handler';

// ─── 상수 ──────────────────────────────────────────────────────────────────

const NOT_FOUND = new Response(null, { status: 404 });

// ─── Secret 검증 (timing-safe) ─────────────────────────────────────────────

function verifyGatewaySecret(incoming: string): boolean {
  const expected = process.env.MCP_GATEWAY_SECRET ?? '';
  if (!expected || incoming.length !== expected.length) return false;
  return timingSafeEqual(
    Buffer.from(incoming, 'utf8'),
    Buffer.from(expected, 'utf8'),
  );
}

// ─── 경로 해시 (secret 유출 방지 — 8자리만) ────────────────────────────────

function pathHash(gateway: string): string {
  return createHash('sha256').update(`/api/mcp/${gateway}`).digest('hex').slice(0, 8);
}

// ─── MCP 요청에서 method 추출 (성공 로깅용) ────────────────────────────────

async function peekMcpMethod(req: NextRequest): Promise<string> {
  try {
    const body = await req.clone().json();
    const method: string = body?.method ?? 'unknown';
    if (method === 'tools/call') return `tools/call:${body?.params?.name ?? '?'}`;
    return method;
  } catch {
    return req.method === 'GET' ? 'sse-connect' : 'unknown';
  }
}

// ─── MCP 핸들러 (lazy init) ────────────────────────────────────────────────

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

  // 1. secret 검증
  if (!verifyGatewaySecret(gateway)) {
    // path_hash만 로깅 — secret 값 자체는 절대 기록 금지
    console.warn(`[mcp-gateway] reject reason=bad_secret path_hash=${pathHash(gateway)}`);
    return NOT_FOUND;
  }

  // 2. IP 대역 검증
  const egress = isAnthropicEgress(req);
  if (!egress.allowed) {
    // IP 전체 기록 (Vercel 로그는 내부용 인프라)
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    console.warn(
      `[mcp-gateway] reject reason=${egress.reason} ip=${ip} path_hash=${pathHash(gateway)}`,
    );
    return NOT_FOUND;
  }

  // 3. 성공 — IP + 요청 메서드 로깅
  const method = await peekMcpMethod(req);
  console.info(`[mcp-gateway] allow ip=${egress.ip} method=${method}`);

  return getHandler()(req);
}

export { handler as GET, handler as POST };
