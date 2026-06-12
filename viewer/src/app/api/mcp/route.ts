import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

function verifyBearer(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.UTTU_MCP_TOKEN ?? '';
  if (!incoming || !expected) return false;
  // 길이가 다르면 timingSafeEqual이 throw하므로 먼저 체크
  const a = Buffer.from(incoming, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!verifyBearer(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // TODO: MCP Streamable HTTP handler (Stage 1)
  return NextResponse.json({ error: 'MCP handler not yet implemented' }, { status: 501 });
}

export async function GET(req: NextRequest) {
  if (!verifyBearer(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // TODO: MCP Streamable HTTP handler (Stage 1)
  return NextResponse.json({ error: 'MCP handler not yet implemented' }, { status: 501 });
}
