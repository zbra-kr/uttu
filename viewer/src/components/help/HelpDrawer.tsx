'use client';
import React from 'react';
import { fetchHelpByPath, type HelpArticle } from '@/lib/queries-help';
import TiptapRenderer from './TiptapRenderer';
import { useIsMobile } from '@/hooks/useViewport';

interface Props {
  pagePath: string | null;
  open: boolean;
  onClose: () => void;
}

export default function HelpDrawer({ pagePath, open, onClose }: Props) {
  const isMobile = useIsMobile();
  const [articles,  setArticles]  = React.useState<HelpArticle[]>([]);
  const [loading,   setLoading]   = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const fetchedRef = React.useRef<string | null>(null);

  // ESC로 닫기
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  // pagePath 변경 시 activeIdx 리셋
  React.useEffect(() => {
    setActiveIdx(0);
  }, [pagePath]);

  // 드로어 열릴 때 데이터 fetch (캐시: 같은 pagePath 재요청 방지)
  React.useEffect(() => {
    if (!open) return;
    if (!pagePath) { setArticles([]); return; }
    if (fetchedRef.current === pagePath) return;

    setLoading(true);
    setArticles([]);
    fetchHelpByPath(pagePath)
      .then(a => {
        setArticles(a);
        fetchedRef.current = pagePath;
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open, pagePath]);

  const active = articles[activeIdx] ?? null;

  return (
    <aside
      aria-label="화면 가이드"
      style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: isMobile ? '100vw' : 480,
        background: 'var(--rai)',
        borderLeft: isMobile ? 'none' : '1px solid var(--bd)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: isMobile ? 100 : 90,
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 250ms ease-out, box-shadow 250ms ease-out',
        boxShadow: open && !isMobile ? '-8px 0 32px rgba(0,0,0,0.10)' : 'none',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {/* ─── sticky 헤더 ─────────────────────────────────────────── */}
      <div style={{
        padding: isMobile ? '14px 16px' : '20px 24px 16px',
        borderBottom: '1px solid var(--bd)',
        flexShrink: 0,
        background: 'var(--rai)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--f4)', marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              사용 가이드
            </div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--f1)', lineHeight: 1.3 }}>
              {loading
                ? '불러오는 중…'
                : active?.title ?? (articles.length === 0 ? '가이드' : active?.title)}
            </div>
          </div>
          <button
            onClick={onClose}
            title="닫기 (ESC)"
            style={isMobile ? {
              width: 28, height: 28, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--snk)', border: '1px solid var(--bs)',
              borderRadius: 7, cursor: 'pointer',
              color: 'var(--f2)', fontSize: 13, lineHeight: 1,
            } : {
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--f3)', padding: '4px 6px', borderRadius: 'var(--r-1)',
              fontSize: 14, lineHeight: 1, flexShrink: 0,
              transition: 'color 100ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--f1)')}
            onMouseLeave={e => (e.currentTarget.style.color = isMobile ? 'var(--f2)' : 'var(--f3)')}
          >
            ✕
          </button>
        </div>

        {/* 탭 (아티클 2개 이상일 때) */}
        {articles.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {articles.map((a, i) => (
              <button
                key={a.id}
                onClick={() => setActiveIdx(i)}
                style={{
                  padding: '3px 10px', borderRadius: 'var(--r-pill)',
                  border: `1px solid ${activeIdx === i ? 'transparent' : 'var(--bd)'}`,
                  fontSize: 'var(--fs-sm)', cursor: 'pointer',
                  background: activeIdx === i ? 'var(--f1)' : 'transparent',
                  color: activeIdx === i ? 'var(--bg)' : 'var(--f3)',
                  transition: 'all 100ms',
                }}
              >
                {a.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ─── 본문 스크롤 영역 ─────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 16 : 24 }}>
        {loading && (
          <div style={{ textAlign: 'center', paddingTop: 40, color: 'var(--f4)', fontSize: 'var(--fs-sm)' }}>
            불러오는 중…
          </div>
        )}

        {!loading && !pagePath && (
          <EmptyState msg="페이지 경로를 감지할 수 없습니다." />
        )}

        {!loading && pagePath && articles.length === 0 && (
          <EmptyState msg="이 화면의 가이드는 아직 준비되지 않았습니다." />
        )}

        {!loading && active && (
          <TiptapRenderer content={active.content} />
        )}
      </div>

      {/* ─── sticky 푸터 ─────────────────────────────────────────── */}
      <div style={{
        padding: '14px 24px',
        borderTop: '1px solid var(--bd)',
        flexShrink: 0,
        background: 'var(--rai)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--f4)' }}>
          {active ? `slug: ${active.slug}` : pagePath ?? '—'}
        </span>
        {/* Stage D 완성 후 활성화 */}
        <span
          title="Stage D에서 /help 페이지 구현 예정"
          style={{
            fontSize: 'var(--fs-sm)', color: 'var(--f4)',
            cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          전체 매뉴얼 보기 →
        </span>
      </div>
    </aside>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ textAlign: 'center', paddingTop: 56, paddingBottom: 40 }}>
      <div style={{ fontSize: 32, marginBottom: 14, opacity: 0.4 }}>📖</div>
      <div style={{ fontSize: 'var(--fs-md)', fontWeight: 500, color: 'var(--f3)', marginBottom: 8 }}>
        가이드 없음
      </div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--f4)', lineHeight: 1.6 }}>
        {msg}
      </div>
      <div style={{ marginTop: 16, fontSize: 'var(--fs-xs)', color: 'var(--f4)' }}>
        관리자 → /admin/guides에서 작성 가능
      </div>
    </div>
  );
}
