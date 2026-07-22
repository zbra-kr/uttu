'use client';
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IcBook, IcSearch, IcShield } from '@/components/ui/icons';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  fetchAllArticles, togglePublish,
  HELP_CATEGORIES,
  type HelpArticleRow,
} from '@/lib/queries-help';
import { fmtDate } from '@/lib/format';

export default function AdminGuidesPage() {
  const router = useRouter();
  const [ready,    setReady]    = React.useState(false);
  const [isAdmin,  setIsAdmin]  = React.useState(false);
  const [articles, setArticles] = React.useState<HelpArticleRow[]>([]);
  const [loading,  setLoading]  = React.useState(true);
  const [search,   setSearch]   = React.useState('');
  const [deferQ,   setDeferQ]   = React.useState('');
  const [category, setCategory] = React.useState('');
  const [toggling, setToggling] = React.useState<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return; }
      const { data: profile } = await sb
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (profile?.role !== 'admin') { router.push('/'); return; }
      setIsAdmin(true);
      setReady(true);
    });
  }, [router]);

  const load = React.useCallback(() => {
    setLoading(true);
    fetchAllArticles({ category: category || undefined, search: deferQ || undefined })
      .then(setArticles)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [category, deferQ]);

  React.useEffect(() => { if (ready) load(); }, [ready, load]);

  const handleSearch = (v: string) => {
    setSearch(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDeferQ(v), 350);
  };

  const handleToggle = async (id: string, current: boolean) => {
    setToggling(id);
    try {
      await togglePublish(id, !current);
      setArticles(prev =>
        prev.map(a => a.id === id ? { ...a, is_published: !current } : a)
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : '토글 실패');
    } finally {
      setToggling(null);
    }
  };

  if (!ready || !isAdmin) {
    return (
      <div style={{ padding: '40px 28px', color: 'var(--f4)', fontSize: 'var(--fs-md)' }}>
        {!ready ? '권한 확인 중…' : '관리자 권한이 필요합니다.'}
      </div>
    );
  }

  const published   = articles.filter(a => a.is_published).length;
  const unpublished = articles.length - published;

  return (
    <>
      <div className="page-title">
        <IcBook size={18} style={{ color: 'var(--hs)' }} />
        <h1>가이드 관리</h1>
        <span className="chip" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>admin</span>
      </div>

      {/* KPI */}
      <div className="grid grid-4 gap-8">
        {([
          ['전체 가이드', articles.length, '개'],
          ['게시됨',      published,       '개'],
          ['비공개',      unpublished,     '개'],
          ['카테고리',    new Set(articles.map(a => a.category ?? '일반')).size, '개'],
        ] as [string, number, string][]).map(([label, val, unit], i) => (
          <div key={i} className="kpi">
            <span className="label">{label}</span>
            <div className="val">{val.toLocaleString()}<span className="unit"> {unit}</span></div>
          </div>
        ))}
      </div>

      {/* 필터 + 검색 + 새로 만들기 */}
      <div className="row-flex gap-8 center">
        <div className="row-flex center gap-6" style={{
          background: 'var(--snk)', border: '1px solid var(--bd)',
          borderRadius: 5, padding: '4px 10px', flex: 1, maxWidth: 280,
        }}>
          <IcSearch size={14} style={{ color: 'var(--f4)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="제목 · slug 검색"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }}
          />
        </div>

        <div className="row-flex gap-4">
          <button className={`btn sm${!category ? ' active' : ''}`} onClick={() => setCategory('')}>전체</button>
          {HELP_CATEGORIES.map(c => (
            <button key={c} className={`btn sm${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>

        <span className="mono dim" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {loading ? '로딩중…' : `${articles.length}개`}
        </span>

        <Link href="/admin/guides/new" className="btn primary sm">
          + 새로 만들기
        </Link>
      </div>

      {/* 테이블 */}
      <section className="panel" style={{ padding: 0 }}>
        <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
          <div className="row head" style={{ gridTemplateColumns: '2fr 1.2fr 100px 80px 90px 48px 60px' }}>
            <span>제목</span>
            <span className="mono">slug</span>
            <span>카테고리</span>
            <span>게시 상태</span>
            <span>수정일</span>
            <span style={{ textAlign: 'center' }}>버전</span>
            <span></span>
          </div>

          {loading && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
              불러오는 중…
            </div>
          )}

          {!loading && articles.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
              가이드가 없습니다.{' '}
              <Link href="/admin/guides/new" style={{ color: 'var(--hs)', textDecoration: 'underline' }}>
                새로 만들기
              </Link>
            </div>
          )}

          {!loading && articles.map((a, i) => (
            <div
              key={a.id}
              className={`row hover${i % 2 ? ' alt' : ''}`}
              style={{ gridTemplateColumns: '2fr 1.2fr 100px 80px 90px 48px 60px', cursor: 'pointer' }}
              onClick={() => router.push(`/admin/guides/${a.id}`)}
            >
              {/* 제목 */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.title}
                </div>
                {a.page_path && (
                  <div className="mono dim" style={{ fontSize: 10 }}>{a.page_path}</div>
                )}
              </div>

              {/* slug */}
              <span className="mono dim" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.slug}
              </span>

              {/* 카테고리 */}
              <span>
                {a.category
                  ? <span className="chip" style={{ fontSize: 10 }}>{a.category}</span>
                  : <span style={{ color: 'var(--f4)', fontSize: 10 }}>—</span>}
              </span>

              {/* 게시 상태 — 클릭 시 즉시 토글 */}
              <span onClick={e => { e.stopPropagation(); handleToggle(a.id, a.is_published); }}>
                {toggling === a.id
                  ? <span style={{ color: 'var(--f4)', fontSize: 10 }}>…</span>
                  : a.is_published
                    ? <span className="chip" style={{ fontSize: 10, background: 'var(--slb)', color: 'var(--slf)', borderColor: 'var(--slf)' }}>게시됨</span>
                    : <span className="chip" style={{ fontSize: 10, color: 'var(--f3)' }}>비공개</span>}
              </span>

              {/* 수정일 */}
              <span className="mono dim" style={{ fontSize: 10 }}>{fmtDate(a.updated_at)}</span>

              {/* 버전 */}
              <span className="mono" style={{ fontSize: 10, color: 'var(--f3)', textAlign: 'center' }}>
                {a.version_count > 0 ? `v${a.version_count}` : '—'}
              </span>

              {/* 편집 */}
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                <IcBook size={13} style={{ color: 'var(--f4)' }} />
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
