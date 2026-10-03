import Link from 'next/link';
import { weeklyMemoHref } from '@/lib/weekly-review';
import { notFound, redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { isUuid } from '@/lib/teams/identity';
import { resolveNoteSource } from '@/lib/notes/source';

export const dynamic = 'force-dynamic';

export default async function MentionNotePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams?: Promise<{ view?: string | string[] }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sb = await supabaseServer();
  // The existing note SELECT RLS permits only the author and mentioned users.
  const { data: note, error } = await sb.from('user_notes')
    .select('id,user_id,body,created_at,entity_type,entity_id,source_context').eq('id', id).single();
  if (error || !note) notFound();
  const weeklySource = weeklyMemoHref(note.body);
  const source = await resolveNoteSource(sb, note);
  const query = await searchParams;
  if (!weeklySource && query?.view !== 'memo' && source.path !== `/me/notes/${id}`) redirect(source.path);
  const { data: author } = await sb.from('profiles_public')
    .select('display_name,full_name').eq('id', note.user_id).maybeSingle();
  return (
    <section className="panel" style={{ padding: 24 }}>
      <h1 style={{ fontSize: 18, marginTop: 0 }}>{source.title} · {weeklySource ? '상품 개선 검토 메모' : '멘션 메모'}</h1>
      {note.entity_type && source.path === `/me/notes/${id}` && <p style={{ fontSize: 12, color: 'var(--f3)' }}>원래 페이지의 저장된 조건을 복원할 수 없어 메모를 표시합니다.</p>}
      <p style={{ fontSize: 12, color: 'var(--f3)' }}>{author?.display_name || author?.full_name || '작성자'}</p>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14, lineHeight: 1.7 }}>{note.body}</div>
      {weeklySource && <p><Link href={weeklySource}>저장 당시 범위의 리뷰 근거 다시 보기</Link></p>}
      <p style={{ marginTop: 24 }}><Link href="/me">내 프로필과 받은 멘션으로 돌아가기</Link></p>
    </section>
  );
}
