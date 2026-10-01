import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { isSameOriginPost, teamsConfig } from '@/lib/teams/config';
import { microsoftIdentity } from '@/lib/teams/identity';
import { beginTeamsConnect, connectCookie, getTeamsConnection } from '@/lib/teams/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});

export async function GET() {
  const config = teamsConfig();
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: '로그인 필요' }, 401);
    const connection = await getTeamsConnection(sb, user.id);
    const identity = config ? microsoftIdentity(user, config.tenantId) : null;
    const identityMatches = !connection || (connection.object_id === identity?.objectId
      && connection.tenant_id === identity?.tenantId);
    return json({ available: !!config && !!identity && identityMatches, connected: !!connection });
  } catch { return json({ available: false, connected: false }); }
}

export async function POST(request: NextRequest) {
  const config = teamsConfig();
  let origin: string;
  try { origin = new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').origin; }
  catch { return json({ error: '연결 주소가 설정되지 않았습니다.' }, 503); }
  if (!isSameOriginPost(request, origin)) return json({ error: '잘못된 요청' }, 403);
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: '로그인 필요' }, 401);
    const { action, return_to: returnTo } = await request.json();
    if (action === 'disconnect') {
      const { error } = await sb.rpc('uttu_teams_disconnect', { p_author_id: user.id });
      if (error) throw new Error();
      const response = json({ connected: false, available: !!config && !!microsoftIdentity(user, config.tenantId) });
      for (const secure of [true, false]) response.cookies.set(connectCookie(secure), '', {
        httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0,
      });
      return response;
    }
    if (action !== 'connect') return json({ error: '잘못된 요청' }, 400);
    if (!config) return json({ error: 'Teams 연결이 아직 설정되지 않았습니다.' }, 503);
    if (returnTo !== undefined && typeof returnTo !== 'string') return json({ error: '잘못된 요청' }, 400);
    const attempt = await beginTeamsConnect(sb, user, config, returnTo);
    const response = json({ url: attempt.url });
    response.cookies.set(connectCookie(config.secure), attempt.cookie, {
      httpOnly: true, secure: config.secure, sameSite: 'lax', path: '/', maxAge: 600,
    });
    return response;
  } catch { return json({ error: 'Teams 연결을 완료하지 못했습니다. 다시 시도해 주세요.' }, 400); }
}
