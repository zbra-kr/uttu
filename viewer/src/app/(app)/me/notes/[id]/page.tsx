import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { isUuid } from '@/lib/teams/identity';
import { resolveNoteSource } from '@/lib/notes/source';

export const dynamic = 'force-dynamic';

export default async function MentionNotePage({ params, searchParams }: {
  params: { id: string }; searchParams?: { view?: string | string[] };
}) {
  if (!isUuid(params.id)) notFound();
  const sb = await supabaseServer();
  // The existing note SELECT RLS permits only the author and mentioned users.
  const { data: note, error } = await sb.from('user_notes')
    .select('id,user_id,body,created_at,entity_type,entity_id,source_context').eq('id', params.id).single();
  if (error || !note) notFound();
  const source = await resolveNoteSource(sb, note);
  if (searchParams?.view !== 'memo' && source.path !== `/me/notes/${params.id}`) redirect(source.path);
  const { data: author } = await sb.from('profiles_public')
    .select('display_name,full_name').eq('id', note.user_id).maybeSingle();
  return (
    <section className="panel" style={{ padding: 24 }}>
      <h1 style={{ fontSize: 18, marginTop: 0 }}>{source.title} · 멘션 메모</h1>
      {note.entity_type && source.path === `/me/notes/${params.id}` && <p style={{ fontSize: 12, color: 'var(--f3)' }}>원래 페이지의 저장된 조건을 복원할 수 없어 메모를 표시합니다.</p>}
      <p style={{ fontSize: 12, color: 'var(--f3)' }}>{author?.display_name || author?.full_name || '작성자'}</p>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14, lineHeight: 1.7 }}>{note.body}</div>
      <p style={{ marginTop: 24 }}><Link href="/me">내 프로필과 받은 멘션으로 돌아가기</Link></p>
    </section>
  );
}
