'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { IcBook, IcShield } from '@/components/ui/icons';
import { supabaseBrowser } from '@/lib/supabase/client';
import { createArticle, HELP_CATEGORIES } from '@/lib/queries-help';
import GuideEditor from '@/components/help/GuideEditor';

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

export default function AdminGuidesNewPage() {
  const router = useRouter();
  const [ready,   setReady]   = React.useState(false);
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [userId,  setUserId]  = React.useState<string | null>(null);

  const [title,    setTitle]    = React.useState('');
  const [slug,     setSlug]     = React.useState('');
  const [slugAuto, setSlugAuto] = React.useState(true);
  const [category, setCategory] = React.useState('');
  const [pagePath, setPagePath] = React.useState('');
  const [content,  setContent]  = React.useState<object>(EMPTY_DOC);
  const [saving,   setSaving]   = React.useState(false);
  const [error,    setError]    = React.useState<string | null>(null);

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

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (slugAuto) setSlug(slugify(v));
  };

  const handleSlugChange = (v: string) => {
    setSlugAuto(false);
    setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-'));
  };

  const save = async (publish: boolean) => {
    if (!title.trim()) { setError('제목을 입력하세요.'); return; }
    if (!slug.trim())  { setError('slug를 입력하세요.'); return; }
    setError(null);
    setSaving(true);
    try {
      const article = await createArticle({
        slug: slug.trim(),
        title: title.trim(),
        page_path: pagePath.trim() || null,
        category: category || null,
        content,
        is_published: publish,
        created_by: userId ?? undefined,
      });
      router.push(`/admin/guides/${article.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  if (!ready || !isAdmin) {
    return (
      <div style={{ padding: '40px 28px', color: 'var(--f4)', fontSize: 'var(--fs-md)' }}>
        {!ready ? '권한 확인 중…' : '관리자 권한이 필요합니다.'}
      </div>
    );
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
        <h1>새 가이드 작성</h1>
        <span className="chip" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>admin</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn sm" onClick={() => router.push('/admin/guides')} disabled={saving}>취소</button>
          <button className="btn sm" onClick={() => save(false)} disabled={saving}>
            {saving ? '저장 중…' : '저장 (비공개)'}
          </button>
          <button className="btn brand sm" onClick={() => save(true)} disabled={saving}>
            {saving ? '저장 중…' : '게시'}
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
          {/* 제목 */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>제목 *</label>
            <input
              value={title}
              onChange={e => handleTitleChange(e.target.value)}
              placeholder="가이드 제목"
              style={{ ...inputStyle, fontSize: 'var(--fs-xl)', fontWeight: 600 }}
            />
          </div>

          {/* slug */}
          <div>
            <label style={labelStyle}>slug * <span className="mono" style={{ fontSize: 10 }}>(영문·숫자·하이픈)</span></label>
            <input
              value={slug}
              onChange={e => handleSlugChange(e.target.value)}
              placeholder="ranking-overview"
              style={{ ...inputStyle, fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' }}
            />
          </div>

          {/* 카테고리 */}
          <div>
            <label style={labelStyle}>카테고리</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{ ...inputStyle }}
            >
              <option value="">— 선택 안 함</option>
              {HELP_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* page_path */}
          <div>
            <label style={labelStyle}>연결 경로 <span style={{ color: 'var(--f4)', fontSize: 10 }}>(선택, 예: /ranking)</span></label>
            <input
              value={pagePath}
              onChange={e => setPagePath(e.target.value)}
              placeholder="/today"
              style={{ ...inputStyle, fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' }}
            />
          </div>
        </div>
      </section>

      {/* 에디터 */}
      <GuideEditor
        content={content}
        onChange={setContent}
        articleId="draft"
        placeholder="가이드 내용을 입력하세요…"
        minHeight="calc(100vh - 380px)"
      />
    </>
  );
}
