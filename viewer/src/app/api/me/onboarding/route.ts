import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type OnboardingStatus = 'pending' | 'completed' | 'skipped' | 'legacy';
type OnboardingState = { userId: string; eligible: boolean; status: OnboardingStatus; step: number };

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'Vary': 'Cookie' },
});
const unavailable = () => json({ error: '가이드 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStep = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5;
const isStatus = (value: unknown): value is Exclude<OnboardingStatus, 'legacy'> =>
  value === 'pending' || value === 'completed' || value === 'skipped';

function stateFromRpc(data: unknown, userId: string): OnboardingState | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row: unknown = data[0];
  if (!isObject(row) || row.user_id !== userId || typeof row.eligible !== 'boolean'
    || (!isStatus(row.status) && row.status !== 'legacy') || !isStep(row.step)
    || (row.status === 'legacy' && (row.eligible || row.step !== 0))) return null;
  return { userId, eligible: row.eligible, status: row.status, step: row.step };
}

export async function GET() {
  try {
    const sb = await supabaseServer();
    const { data: { user }, error: authError } = await sb.auth.getUser();
    if (authError || !user) return json({ error: '로그인 필요' }, 401);
    const { data, error } = await sb.rpc('get_my_onboarding');
    if (error) return unavailable();
    const state = stateFromRpc(data, user.id);
    return state ? json(state) : unavailable();
  } catch { return unavailable(); }
}

function isSameOriginJson(request: NextRequest): boolean {
  return request.headers.get('origin') === request.nextUrl.origin
    && [null, 'same-origin'].includes(request.headers.get('sec-fetch-site'))
    && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json';
}

async function mutate(request: NextRequest, replay: boolean) {
  if (!isSameOriginJson(request)) return json({ error: '잘못된 요청' }, 403);
  try {
    const sb = await supabaseServer();
    const { data: { user }, error: authError } = await sb.auth.getUser();
    if (authError || !user) return json({ error: '로그인 필요' }, 401);

    let body: unknown;
    try {
      const raw = await request.text();
      if (raw.length > 1024) return json({ error: '잘못된 요청' }, 400);
      body = JSON.parse(raw);
    } catch { return json({ error: '잘못된 요청' }, 400); }
    if (!isObject(body)) return json({ error: '잘못된 요청' }, 400);
    if (replay ? Object.keys(body).length !== 1 || body.action !== 'replay'
      : Object.keys(body).length !== 2 || !isStatus(body.status) || !isStep(body.step)) {
      return json({ error: '잘못된 요청' }, 400);
    }

    // Never accept owner identity or eligibility from the browser. The RPC
    // derives both from the verified session and Auth-owned account creation.
    const { data, error } = await sb.rpc('save_my_onboarding', {
      p_status: replay ? 'pending' : body.status,
      p_step: replay ? 0 : body.step,
      p_replay: replay,
    });
    if (error) {
      if (error.code === '42501') return json({ error: '가이드를 다시 시작해 주세요.' }, 403);
      if (error.code === '22023') return json({ error: '잘못된 요청' }, 400);
      return unavailable();
    }
    const state = stateFromRpc(data, user.id);
    return state ? json(state) : unavailable();
  } catch { return unavailable(); }
}

export async function PATCH(request: NextRequest) { return mutate(request, false); }
export async function POST(request: NextRequest) { return mutate(request, true); }
