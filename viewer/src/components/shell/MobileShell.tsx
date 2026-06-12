'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import AiPanel from './AiPanel';
import {
  IcHome, IcSpark, IcRanking, IcFlag, IcUser,
  IcReport, IcBrandRanking, IcCompany, IcReview, IcPromo,
  IcBook, IcSnap, IcLink, IcRecommend, IcShield, IcBell, IcX, IcChevL,
} from '../ui/icons';
import { fetchUnreadCount } from '@/lib/queries-me';
import InboxList from '../me/InboxList';
import type { ShellStats } from '@/lib/queries';

/* ── left drawer nav definition ── */
type NavItem = { id: string; path: string; label: string; Icon: React.ComponentType<{ size?: number }>; badge?: number; adminOnly?: boolean };
type NavSection = { divider: true };
const DRAWER_NAV: (NavItem | NavSection)[] = [
  { id: 'home',          path: '/',              label: '홈',           Icon: IcHome      },
  { id: 'today',         path: '/today',         label: '오늘의 매거진', Icon: IcSpark     },
  { id: 'report',        path: '/report',        label: '심층 리포트',  Icon: IcReport    },
  { divider: true },
  { id: 'ranking',       path: '/ranking',       label: '상품 랭킹',    Icon: IcRanking   },
  { id: 'brand-ranking', path: '/brand-ranking', label: '브랜드 랭킹',  Icon: IcBrandRanking },
  { id: 'companies',     path: '/companies',     label: '회사 목록',    Icon: IcCompany   },
  { id: 'reviews',       path: '/reviews',       label: '자사 리뷰',    Icon: IcReview    },
  { id: 'promo',         path: '/promo',         label: '프로모션',     Icon: IcPromo     },
  { id: 'magazine',      path: '/magazine',      label: '매거진',       Icon: IcBook      },
  { id: 'snap',          path: '/snap',          label: '스냅샷',       Icon: IcSnap      },
  { id: 'anomaly',       path: '/anomaly',       label: '이상탐지',     Icon: IcFlag      },
  { id: 'matching',      path: '/matching',      label: '자사 매칭',    Icon: IcLink      },
  { id: 'recommend',     path: '/recommend',     label: '추천판',       Icon: IcRecommend },
  { divider: true },
  { id: 'me',            path: '/me',            label: '내 정보',      Icon: IcUser      },
  { id: 'admin',         path: '/admin',         label: '관리자',       Icon: IcShield,   adminOnly: true },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function isActive(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname.startsWith(path);
}

interface MobileShellProps {
  children: React.ReactNode;
  shellStats: ShellStats | null;
  context: string[];
}

const ROOT_PATHS = new Set(['/']);

export default function MobileShell({ children, shellStats, context }: MobileShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [aipOpen, setAipOpen] = React.useState(false);
  const [bellOpen, setBellOpen] = React.useState(false);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [user, setUser] = React.useState<{
    name: string; email: string; initials: string; role: string; avatarUrl: string | null;
  } | null>(null);

  const anomalyCount = shellStats?.anomalyCount ?? 0;

  React.useEffect(() => {
    fetchUnreadCount().then(setUnreadCount);
    const id = setInterval(() => fetchUnreadCount().then(setUnreadCount), 30000);
    return () => clearInterval(id);
  }, []);

  /* close bell on route change */
  React.useEffect(() => { setBellOpen(false); }, [pathname]);

  React.useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await sb
        .from('profiles_public')
        .select('display_name, role, avatar_url')
        .eq('id', data.user.id)
        .single();
      const name = profile?.display_name || data.user.email?.split('@')[0] || '?';
      setUser({
        name,
        email: data.user.email ?? '',
        initials: getInitials(name),
        role: profile?.role ?? 'viewer',
        avatarUrl: profile?.avatar_url ?? null,
      });
    });
  }, []);

  const mainRef = React.useRef<HTMLElement>(null);

  /* iOS tap-to-top: status bar tap fires touchstart at y < 20px on window.
   * Since <main> is the scroll container (not window), we detect the touch
   * and manually scroll main to top. */
  React.useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      const main = mainRef.current;
      if (!main || main.scrollTop === 0) return;
      const touch = e.touches[0];
      if (touch && touch.clientY < 20) {
        main.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    return () => window.removeEventListener('touchstart', handleTouchStart);
  }, []);

  /* close drawer on route change */
  React.useEffect(() => { setDrawerOpen(false); }, [pathname]);

  const toggleAip = () => setAipOpen(o => !o);

  return (
    <div style={{ position: 'relative', height: '100dvh', width: '100vw', maxWidth: '100vw', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── Header (52px sticky) ── */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 52, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 11, padding: '0 15px',
        borderBottom: '1px solid var(--bs)', background: 'var(--sur)',
        flexShrink: 0,
      }}>
        {/* hamburger */}
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            width: 30, height: 30, border: '1px solid var(--bs)', borderRadius: 7,
            background: 'var(--snk)', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 3.5,
            cursor: 'pointer', flexShrink: 0, padding: 0,
          }}
        >
          {[0,1,2].map(i => (
            <span key={i} style={{ width: 13, height: 1.5, background: 'var(--f2)', borderRadius: 1 }} />
          ))}
        </button>

        {/* back button — root 탭 페이지에서는 숨김 */}
        {!ROOT_PATHS.has(pathname) && (
          <button
            onClick={() => router.back()}
            style={{
              width: 30, height: 30, border: '1px solid var(--bs)', borderRadius: 7,
              background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, padding: 0, color: 'var(--f2)',
            }}
            aria-label="뒤로"
          >
            <IcChevL size={15} />
          </button>
        )}

        {/* wordmark — 홈 링크 */}
        <Link href="/" style={{ display: 'flex', alignItems: 'baseline', fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, letterSpacing: '-0.03em', flex: 1, textDecoration: 'none', color: 'var(--f1)' }}>
          uttu
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--hs)', alignSelf: 'flex-end', marginBottom: 4, marginLeft: 2 }} />
        </Link>

        {/* right: bell + avatar */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setBellOpen(o => !o)}
            style={{
              width: 30, height: 30, border: '1px solid var(--bs)', borderRadius: 7,
              background: bellOpen ? 'var(--hs-soft)' : 'var(--snk)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              color: bellOpen ? 'var(--hs)' : 'var(--f2)',
              position: 'relative', padding: 0,
            }}
          >
            <IcBell size={15} />
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4, minWidth: 14, height: 14,
                padding: '0 3px', background: 'var(--shf)', color: 'var(--white)',
                borderRadius: 7, fontSize: 9, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--mono)', pointerEvents: 'none',
              }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <Link href="/me" style={{ textDecoration: 'none' }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7, background: 'var(--snk)',
              border: '1px solid var(--bs)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--f2)',
              fontFamily: 'var(--mono)', overflow: 'hidden',
            }}>
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                user?.initials ?? '?'
              )}
            </div>
          </Link>
        </div>
      </header>

      {/* ── Main content ── */}
      <main ref={mainRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        width: '100%', maxWidth: '100%', minWidth: 0,
        paddingTop: 52, paddingBottom: 20,
        background: 'var(--bg)',
        backgroundImage: 'radial-gradient(circle, var(--bs) 0.8px, transparent 0.8px)',
        backgroundSize: '14px 14px',
        WebkitOverflowScrolling: 'touch',
      }}>
        {children}
      </main>

      {/* ── Bell bottom sheet ── */}
      {bellOpen && (
        <>
          {/* scrim */}
          <div
            style={{ position: 'fixed', inset: 0, background: 'var(--img-overlay)', zIndex: 60 }}
            onClick={() => setBellOpen(false)}
          />
          {/* panel */}
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70,
            background: 'var(--sur)', borderTop: '1px solid var(--bs)',
            borderRadius: '16px 16px 0 0',
            boxShadow: '0 -8px 32px rgba(0,0,0,0.18)',
            maxHeight: '72dvh', display: 'flex', flexDirection: 'column',
          }}>
            {/* handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 4 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bs)' }} />
            </div>
            {/* header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 10px', borderBottom: '1px solid var(--bs)' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--f1)' }}>알림</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Link href="/me#inbox" onClick={() => setBellOpen(false)}
                  style={{ fontSize: 12, color: 'var(--hs)', textDecoration: 'none', fontWeight: 500 }}>
                  전체 보기
                </Link>
                <button onClick={() => setBellOpen(false)}
                  style={{ width: 26, height: 26, border: '1px solid var(--bs)', borderRadius: 7, background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--f3)', padding: 0 }}>
                  <IcX size={13} />
                </button>
              </div>
            </div>
            {/* list */}
            <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <InboxList limit={15} compact onUnreadChange={setUnreadCount} />
            </div>
          </div>
        </>
      )}

      {/* ── FAB (AI) ── */}
      <button
        onClick={toggleAip}
        style={{
          position: 'fixed', right: 16, bottom: 20, zIndex: 50,
          width: 56, height: 56, borderRadius: 18,
          background: 'var(--hs)', color: 'var(--white)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
          border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)',
          boxShadow: '0 10px 24px -8px color-mix(in oklch, var(--hs) 60%, transparent)',
        }}
        aria-label="AI 어시스턴트 열기"
      >
        AI
      </button>


      {/* ── Left drawer ── */}
      {drawerOpen && (
        <>
          {/* scrim */}
          <div
            style={{ position: 'fixed', inset: 0, background: 'var(--img-overlay)', zIndex: 70 }}
            onClick={() => setDrawerOpen(false)}
          />
          {/* panel */}
          <div style={{
            position: 'fixed', top: 0, left: 0, bottom: 0, width: 280, zIndex: 80,
            background: 'var(--sur)', borderRight: '1px solid var(--bs)',
            display: 'flex', flexDirection: 'column',
            boxShadow: '14px 0 44px -12px rgba(28,25,23,.4)',
          }}>
            {/* user section */}
            <div style={{ padding: '50px 18px 15px', borderBottom: '1px solid var(--bs)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 13, fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em' }}>
                uttu
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--hs)', alignSelf: 'flex-end', marginBottom: 3, marginLeft: 2 }} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>
                {user?.name ?? '…'}
                {user?.role && (
                  <span style={{
                    fontSize: 10, color: 'var(--hs)', border: '1px solid var(--hs)',
                    borderRadius: 5, padding: '1px 5px', marginLeft: 6, fontWeight: 500,
                  }}>
                    {user.role}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--f3)', marginTop: 3, fontFamily: 'var(--mono)' }}>
                {user?.email ?? ''}
              </div>
            </div>

            {/* close button inside drawer header */}
            <button
              onClick={() => setDrawerOpen(false)}
              style={{
                position: 'absolute', top: 14, right: 14,
                width: 28, height: 28, border: '1px solid var(--bs)', borderRadius: 7,
                background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--f3)', padding: 0,
              }}
            >
              <IcX size={14} />
            </button>

            {/* nav links */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {DRAWER_NAV.map((item, i) => {
                if ('divider' in item) {
                  return <div key={`div-${i}`} style={{ height: 1, background: 'var(--bs)', margin: '7px 11px' }} />;
                }
                const { id, path, label, Icon, adminOnly } = item;
                if (adminOnly && user?.role !== 'admin') return null;
                const active = isActive(pathname, path);
                return (
                  <Link
                    key={id}
                    href={path}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 11, padding: '8px 11px',
                      borderRadius: 7, fontSize: 12.5, color: active ? 'var(--hs)' : 'var(--f2)',
                      background: active ? 'var(--hs-soft)' : 'transparent',
                      fontWeight: active ? 600 : 400, textDecoration: 'none',
                    }}
                  >
                    <span style={{ width: 18, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={15} />
                    </span>
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── AI Panel (reuses desktop component) ── */}
      <AiPanel
        open={aipOpen}
        onToggle={toggleAip}
        context={context}
        route={pathname}
        mobileMode
      />
    </div>
  );
}
