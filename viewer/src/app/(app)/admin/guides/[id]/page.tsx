'use client';
import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { IcBook } from '@/components/ui/icons';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  fetchArticleById, updateArticle, togglePublish,
  fetchHelpVersions,
  HELP_CATEGORIES,
  type HelpArticle, type HelpArticleVersion,
} from '@/lib/queries-help';
import GuideEditor from '@/components/help/GuideEditor';
import { fmtDate } from '@/lib/format';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

export default function AdminGuideEditPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const [ready,    setReady]    = React.useState(false);
  const [isAdmin,  setIsAdmin]  = React.useState(false);
  const [userId,   setUserId]   = React.useState<string | null>(null);
  const [article,  setArticle]  = React.useState<HelpArticle | null>(null);
  const [versions, setVersions] = React.useState<HelpArticleVersion[]>([]);
  const [notFound, setNotFound] = React.useState(false);

  const [title,      setTitle]      = React.useState('');
  const [slug,       setSlug]       = React.useState('');
  const [slugAuto,   setSlugAuto]   = React.useState(false);
  const [category,   setCategory]   = React.useState('');
  const [pagePath,   setPagePath]   = React.useState('');
  const [content,    setContent]    = React.useState<object>({});
  const [changeNote, setChangeNote] = React.useState('');
  const [saving,     setSaving]     = React.useState(false);
  const [toggling,   setToggling]   = React.useState(false);
  const [error,      setError]      = React.useState<string | null>(null);
  const [saved,      setSaved]      = React.useState(false);

  React.useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return; }
      const { data: profile } = await sb
        .from('profiles').select('role').eq('id', user.id).single();
      if (profile?.role !== 'admin') { router.push('/'); return; }
      setUserId(user.id);
      setIsAdmin(true);
      setReady(true);
    });
  }, [router]);

  React.useEffect(() => {
    if (!ready || !id) return;
    fetchArticleById(id)
      .then(a => {
        if (!a) { setNotFound(true); return; }
        setArticle(a);
        setTitle(a.title);
        setSlug(a.slug);
        setCategory(a.category ?? '');
        setPagePath(a.page_path ?? '');
        setContent(a.content);
      })
      .catch(() => setNotFound(true));
    fetchHelpVersions(id).then(setVersions).catch(() => {});
  }, [ready, id]);

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (slugAuto) setSlug(slugify(v));
  };

  const handleSlugChange = (v: string) => {
    setSlugAuto(false);
    setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-'));
  };

  const save = async (publish?: boolean) => {
    if (!title.trim()) { setError('제목을 입력하세요.'); return; }
    if (!slug.trim())  { setError('slug를 입력하세요.'); return; }
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const updated = await updateArticle(id, {
        title: title.trim(),
        page_path: pagePath.trim() || null,
        category: category || null,
        content,
        is_published: publish !== undefined ? publish : article?.is_published,
        updated_by: userId ?? undefined,
        changeNote: changeNote.trim() || undefined,
      });
      setArticle(updated);
      setChangeNote('');
      setSaved(true);
      // 버전 목록 새로고침
      fetchHelpVersions(id).then(setVersions).catch(() => {});
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublish = async () => {
    if (!article) return;
    setToggling(true);
    try {
      await togglePublish(id, !article.is_published);
      setArticle(prev => prev ? { ...prev, is_published: !prev.is_published } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : '게시 상태 변경 실패');
    } finally {
      setToggling(false);
    }
  };

  if (!ready || !isAdmin) {
    return (
      <div style={{ padding: '40px 28px', color: 'var(--f4)', fontSize: 'var(--fs-md)' }}>
        {!ready ? '권한 확인 중…' : '관리자 권한이 필요합니다.'}
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={{ padding: '40px 28px' }}>
        <div style={{ color: 'var(--shf)', marginBottom: 12, fontSize: 'var(--fs-md)' }}>가이드를 찾을 수 없습니다.</div>
        <button className="btn sm" onClick={() => router.push('/admin/guides')}>목록으로</button>
      </div>
    );
  }

  if (!article) {
    return <div style={{ padding: '40px 28px', color: 'var(--f4)', fontSize: 'var(--fs-md)' }}>불러오는 중…</div>;
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg)', border: '1px solid var(--bd)',
    borderRadius: 'var(--r-2)', padding: '8px 12px', fontSize: 'var(--fs-md)',
    color: 'var(--f1)', outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--fs-sm)', color: 'var(--f3)', marginBottom: 4, display: 'block',
  };

  return (
    <>
      {/* 헤더 */}
      <div className="page-title" style={{ marginBottom: 20 }}>
        <IcBook size={18} style={{ color: 'var(--hs)' }} />
        <h1 style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {article.title}
        </h1>
        {article.is_published
          ? <span className="chip" style={{ fontSize: 10, background: 'var(--slb)', color: 'var(--slf)', borderColor: 'var(--slf)' }}>게시됨</span>
          : <span className="chip" style={{ fontSize: 10, color: 'var(--f3)' }}>비공개</span>}

        {saved && (
          <span style={{ color: 'var(--slf)', fontSize: 'var(--fs-sm)' }}>✓ 저장됨</span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm" onClick={() => router.push('/admin/guides')} disabled={saving}>목록</button>
          <button
            className="btn sm"
            onClick={handleTogglePublish}
            disabled={toggling}
          >
            {toggling ? '처리 중…' : article.is_published ? '비공개 전환' : '게시'}
          </button>
          <button className="btn brand sm" onClick={() => save()} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 'var(--r-2)',
          background: 'var(--shb)', color: 'var(--shf)',
          fontSize: 'var(--fs-sm)', marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* 메타 영역 */}
      <section className="panel surface" style={{ marginBottom: 16 }}>
        <div className="grid grid-2 gap-16">
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>제목 *</label>
            <input
              value={title}
              onChange={e => handleTitleChange(e.target.value)}
              style={{ ...inputStyle, fontSize: 'var(--fs-xl)', fontWeight: 600 }}
            />
          </div>

          <div>
            <label style={labelStyle}>slug * <span className="mono" style={{ fontSize: 10 }}>(영문·숫자·하이픈)</span></label>
            <input
              value={slug}
              onChange={e => handleSlugChange(e.target.value)}
              style={{ ...inputStyle, fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' }}
            />
          </div>

          <div>
            <label style={labelStyle}>카테고리</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle }}>
              <option value="">— 선택 안 함</option>
              {HELP_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>연결 경로 <span style={{ color: 'var(--f4)', fontSize: 10 }}>(선택, 예: /ranking)</span></label>
            <input
              value={pagePath}
              onChange={e => setPagePath(e.target.value)}
              placeholder="/today"
              style={{ ...inputStyle, fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' }}
            />
          </div>

          {/* 변경 사유 */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>변경 사유 <span style={{ color: 'var(--f4)', fontSize: 10 }}>(선택, 버전 메모에 저장됨)</span></label>
            <input
              value={changeNote}
              onChange={e => setChangeNote(e.target.value)}
              placeholder="어떤 내용을 수정했나요?"
              style={{ ...inputStyle }}
            />
          </div>
        </div>
      </section>

      {/* 에디터 */}
      <GuideEditor
        content={content}
        onChange={setContent}
        articleId={id}
        placeholder="가이드 내용을 입력하세요…"
        minHeight="calc(100vh - 420px)"
      />

      {/* 버전 히스토리 */}
      <section className="panel surface" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--f2)' }}>
            버전 히스토리 ({versions.length}개)
          </span>
          <span className="chip" style={{ fontSize: 10, color: 'var(--f4)' }}>
            상세 보기 — Stage H에서 구현 예정
          </span>
        </div>

        {versions.length === 0 ? (
          <div style={{ color: 'var(--f4)', fontSize: 'var(--fs-sm)' }}>
            아직 수정 이력이 없습니다. 첫 저장 이후 변경사항이 기록됩니다.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {versions.slice(0, 8).map(v => (
              <div key={v.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '6px 10px', borderRadius: 'var(--r-2)', background: 'var(--bg)',
              }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--f3)', flexShrink: 0 }}>
                  v{v.version_number}
                </span>
                <span style={{ fontSize: 'var(--fs-sm)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.note || v.title}
                </span>
                <span className="mono dim" style={{ fontSize: 10, flexShrink: 0 }}>
                  {fmtDate(v.created_at)}
                </span>
              </div>
            ))}
            {versions.length > 8 && (
              <div style={{ color: 'var(--f4)', fontSize: 10, textAlign: 'center', padding: 4 }}>
                … {versions.length - 8}개 더
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 10, color: 'var(--f4)' }}>
          최초 작성: {fmtDate(article.created_at)} &nbsp;·&nbsp; 마지막 수정: {fmtDate(article.updated_at)}
        </div>
      </section>
    </>
  );
}
