import { timingSafeEqual } from 'crypto';
import { NextRequest } from 'next/server';
import { createUttuMcpHandler } from '@/lib/mcp/handler';

// ─── Bearer 인증 ───────────────────────────────────────────────────────────
function verifyBearer(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.UTTU_MCP_TOKEN ?? '';
  if (!incoming || !expected) return false;
  const a = Buffer.from(incoming, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const mcpHandler = createUttuMcpHandler('/api/mcp');

async function handler(req: NextRequest): Promise<Response> {
  if (!verifyBearer(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return mcpHandler(req);
}

export { handler as GET, handler as POST };
