import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function requireAdmin() {
  const ss = await supabaseServer();
  const { data: { user } } = await ss.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: '인증 필요' }, { status: 401 }), user: null, ss };
  }
  const { data: prof } = await ss.from('profiles').select('role').eq('id', user.id).single();
  if (prof?.role !== 'admin') {
    return { error: NextResponse.json({ error: '관리자 권한 필요' }, { status: 403 }), user: null, ss };
  }
  return { error: null, user, ss };
}
