import { requireAdmin } from '@/lib/auth/require-admin';
import { NextResponse } from 'next/server';

function todayKstStart(): string {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  return `${today}T00:00:00+09:00`;
}

export async function GET() {
  const { error, ss } = await requireAdmin();
  if (error) return error;

  const { data, error: dbErr } = await ss
    .from('collection_jobs')
    .select('*')
    .gte('started_at', todayKstStart())
    .order('updated_at', { ascending: false })
    .limit(200);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ jobs: data ?? [] });
}
