import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const h = (name: string) => req.headers.get(name);

  return Response.json({
    'x-forwarded-for':            h('x-forwarded-for'),
    'x-real-ip':                  h('x-real-ip'),
    'x-vercel-forwarded-for':     h('x-vercel-forwarded-for'),
    'x-vercel-proxied-for':       h('x-vercel-proxied-for'),
    '@vercel/functions ipAddress': null, // 패키지 미설치
  });
}
