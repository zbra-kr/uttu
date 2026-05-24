import { requireAdmin } from '@/lib/auth/require-admin';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { error, ss } = await requireAdmin();
  if (error) return error;

  const { data, error: dbErr } = await ss
    .from('collection_jobs')
    .select('*')
    .eq('id', params.id)
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: '없는 job' }, { status: 404 });
  return NextResponse.json({ job: data });
}
