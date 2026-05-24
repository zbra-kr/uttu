import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

function buildLink(entity_type: string | null, entity_id: string | null): string {
  if (!entity_type || !entity_id) return '/me';
  const page = entity_type === 'ranking_filter' ? 'ranking' : entity_type;
  return `/${page}?id=${encodeURIComponent(entity_id)}&notes=open`;
}

export async function POST(req: NextRequest) {
  const ss = await supabaseServer();
  const { data: { user } } = await ss.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  let note_id: string | undefined;
  try {
    ({ note_id } = await req.json());
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }
  if (!note_id) return NextResponse.json({ error: 'note_id 필수' }, { status: 400 });

  const admin = adminClient();

  const { data: note } = await admin
    .from('user_notes')
    .select('id, user_id, body, entity_type, entity_id, mentioned_user_ids')
    .eq('id', note_id)
    .single();

  if (!note || note.user_id !== user.id) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 });
  }

  const targets = (note.mentioned_user_ids ?? []).filter((uid: string) => uid !== user.id);
  if (targets.length === 0) return NextResponse.json({ inserted: 0 });

  const { data: author } = await admin
    .from('profiles')
    .select('display_name, full_name')
    .eq('id', user.id)
    .single();
  const authorLabel = author?.display_name || author?.full_name || '누군가';

  const link = buildLink(note.entity_type, note.entity_id);

  const rows = targets.map((uid: string) => ({
    user_id: uid,
    event_type: 'mention',
    title: `${authorLabel}님이 회원님을 멘션했습니다`,
    body: note.body.slice(0, 200),
    link,
    payload: { note_id: note.id, author_id: user.id },
  }));

  const { error } = await admin.from('user_notifications').insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ inserted: rows.length });
}
