'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { IcHome, IcRanking, IcBrandRanking, IcFlag, IcCompany, IcBrand, IcProduct, IcPromo, IcSnap, IcBook, IcReview, IcLink, IcMapping, IcMore, IcChevL, IcChevR, IcChevD, IcShield, IcUsers, IcSpark, IcBell, IcCalendar, IcHelp, IcReport, IcRecommend } from '../ui/icons';

const MANUAL_URL = 'https://www.notion.so/36b7af342d908176b629c6343d1c35a7';

type RouteItem = {
  id: string;
  path: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  parent?: string;
  external?: boolean;
  adminOnly?: boolean;
};

const ROUTES: RouteItem[] = [
  { id: 'home',                path: '/',                    label: '홈',           Icon: IcHome                      },
  { id: 'today',               path: '/today',               label: '오늘의 매거진',Icon: IcSpark                     },
  { id: 'report',              path: '/report',              label: '심층 리포트',  Icon: IcReport                    },
  { id: 'ranking',             path: '/ranking',             label: '상품 랭킹',    Icon: IcRanking                   },
  { id: 'product',             path: '/product',             label: '상품',         Icon: IcProduct,   parent: 'ranking'       },
  { id: 'brand-ranking',       path: '/brand-ranking',       label: '브랜드 랭킹',  Icon: IcBrandRanking              },
  { id: 'brand',               path: '/brand',               label: '브랜드',       Icon: IcBrand,     parent: 'brand-ranking' },
  { id: 'anomaly',             path: '/anomaly',             label: '이상탐지',     Icon: IcFlag                      },
  { id: 'companies',           path: '/companies',           label: '회사 목록',    Icon: IcCompany                   },
  { id: 'company',             path: '/company',             label: '회사 상세',    Icon: IcCompany,   parent: 'companies'     },
  { id: 'promo',               path: '/promo',               label: '프로모션',     Icon: IcPromo                     },
  { id: 'recommend',           path: '/recommend',           label: '추천판',       Icon: IcRecommend                 },
  { id: 'snap',                path: '/snap',                label: '스냅샷',       Icon: IcSnap                      },
  { id: 'magazine',            path: '/magazine',            label: '매거진',       Icon: IcBook                      },
  { id: 'reviews',             path: '/reviews',             label: '리뷰',         Icon: IcReview                    },
  { id: 'matching',            path: '/matching',            label: '자사 매칭',    Icon: IcLink                      },
  { id: 'manual',              path: MANUAL_URL,             label: '사용 매뉴얼',  Icon: IcHelp,      external: true          },
  // ── 관리자 그룹 (adminOnly) ─────────────────────────────────────────────────
  { id: 'admin',               path: '/admin',               label: '관리자',       Icon: IcShield,    adminOnly: true         },
  { id: 'admin-dashboard',     path: '/admin',               label: '관리 대시보드',Icon: IcShield,    parent: 'admin', adminOnly: true },
  { id: 'admin-users',         path: '/admin/users',         label: '사용자 관리',  Icon: IcUsers,     parent: 'admin', adminOnly: true },
  { id: 'admin-llm',           path: '/admin/llm',           label: 'LLM 관리',     Icon: IcSpark,     parent: 'admin', adminOnly: true },
  { id: 'admin-jobs',          path: '/admin/jobs',          label: '수집 모니터링',Icon: IcCalendar,  parent: 'admin', adminOnly: true },
  { id: 'admin-notifications', path: '/admin/notifications', label: '알림 모니터링',Icon: IcBell,      parent: 'admin', adminOnly: true },
  { id: 'admin-mapping',       path: '/admin/mapping',       label: 'DART 매핑',    Icon: IcMapping,   parent: 'admin', adminOnly: true },
  { id: 'admin-anomalies',     path: '/admin/anomalies',     label: '이상탐지 룰',  Icon: IcFlag,      parent: 'admin', adminOnly: true },
  { id: 'admin-guides',        path: '/admin/guides',        label: '가이드 관리',  Icon: IcBook,      parent: 'admin', adminOnly: true },
  { id: 'admin-audit',         path: '/admin/audit',         label: '감사 로그',    Icon: IcBook,      parent: 'admin', adminOnly: true },
];

const GROUP_PARENTS = new Set(ROUTES.filter(r => r.parent).map(r => r.parent!));

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  theme: string;
  navCounts?: Record<string, number>;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Sidebar({ collapsed, onToggle, theme, navCounts = {} }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const [hovering, setHovering] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [user, setUser] = React.useState<{ name: string; email: string; initials: string; role: string; avatarUrl: string | null } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const isPeek  = collapsed && hovering;
  const show    = !collapsed || hovering;
  const isAdmin = user?.role === 'admin';

  // 로그인 유저 정보
  React.useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const email = data.user.email ?? '';
      const { data: profile } = await sb
        .from('profiles')
        .select('full_name, display_name, role, avatar_url')
        .eq('id', data.user.id)
        .single();
      const name = profile?.full_name || email.split('@')[0];
      setUser({ name, email, initials: getInitials(name), role: profile?.role ?? 'viewer', avatarUrl: profile?.avatar_url ?? null });
    });
  }, []);

  // 외부 클릭 시 메뉴 닫기
  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await supabaseBrowser().auth.signOut();
    router.push('/login');
  };

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname === path || pathname.startsWith(path + '/');
  };

  const [open, setOpen] = React.useState<Set<string>>(() => {
    const s = new Set<string>();
    ROUTES.forEach(r => {
      if (r.parent && (pathname === r.path || pathname.startsWith(r.path + '/'))) {
        s.add(r.parent);
      }
    });
    return s;
  });

  // 페이지 이동 시 해당 부모 그룹 자동 열기
  React.useEffect(() => {
    setOpen(s => {
      const n = new Set(s);
      ROUTES.forEach(r => {
        if (r.parent && (pathname === r.path || pathname.startsWith(r.path + '/'))) {
          n.add(r.parent);
        }
      });
      return n;
    });
  }, [pathname]);

  const toggleGroup = (id: string) => {
    setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  return (
    <aside
      className={`sb${collapsed && !hovering ? ' collapsed' : ''}${isPeek ? ' peek' : ''}`}
      onMouseEnter={() => collapsed && setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="sb-brand">
        {show && (
          <Link href="/" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <img
              src={theme === 'dark'
                ? '/images/uttu/svg/uttu-wordmark-white.svg'
                : '/images/uttu/svg/uttu-wordmark.svg'}
              alt="UTTU"
              style={{ height: 22, objectFit: 'contain', objectPosition: 'left' }}
            />
          </Link>
        )}
        <button
          className="toggle"
          onClick={onToggle}
          title={show ? '메뉴 접기' : '메뉴 펼치기'}
          style={{ marginLeft: show ? 'auto' : 0 }}
        >
          {collapsed ? <IcChevR /> : <IcChevL />}
        </button>
      </div>

      {show && <div className="sb-section">workspace</div>}
      <nav className="sb-nav">
        {ROUTES.map(r => {
          if (r.adminOnly && !isAdmin) return null;

          const isSub    = !!r.parent;
          const isParent = GROUP_PARENTS.has(r.id);
          const isOpen   = open.has(r.id);
          const isExt    = !!r.external;

          if (isSub && !open.has(r.parent!)) return null;

          // 관리자 그룹 상단에 구분선
          const showDivider = r.id === 'admin' && show;

          return (
            <React.Fragment key={r.id}>
              {showDivider && (
                <div style={{ height: 1, background: 'var(--bd)', margin: '6px 10px' }} />
              )}
              <div style={{ position: 'relative' }}>
                {isExt ? (
                  <a
                    href={r.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sb-item"
                    title={!show ? r.label : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: show ? 8 : 0 }}
                  >
                    <r.Icon size={16} />
                    {show && <span>{r.label}</span>}
                  </a>
                ) : (
                  <Link
                    href={r.path}
                    className={`sb-item${isSub ? ' sub' : ''} ${isActive(r.path) ? 'active' : ''}`}
                    title={!show ? r.label : undefined}
                  >
                    <r.Icon size={isSub ? 13 : 16} />
                    {show && <span>{r.label}</span>}
                    {show && navCounts[r.id] ? <span className="num">{navCounts[r.id]}</span> : null}
                  </Link>
                )}
                {show && isParent && (
                  <button
                    className="sb-toggle"
                    onClick={e => { e.preventDefault(); toggleGroup(r.id); }}
                    title={isOpen ? '접기' : '펼치기'}
                  >
                    <IcChevD size={12} style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms ease' }} />
                  </button>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </nav>

      {/* 하단 유저 영역 */}
      <div ref={menuRef} style={{ position: 'relative', marginTop: 'auto' }}>

        {/* 드롭업 메뉴 */}
        {menuOpen && show && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
            background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 7,
            padding: 4, zIndex: 200,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
          }}>
            <Link
              href="/me"
              onClick={() => setMenuOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5, fontSize: 12, color: 'var(--f1)', textDecoration: 'none', transition: 'background 100ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--snk)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              내 프로필
            </Link>
            <Link
              href="/me?tab=password"
              onClick={() => setMenuOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5, fontSize: 12, color: 'var(--f1)', textDecoration: 'none', transition: 'background 100ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--snk)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              비밀번호 변경
            </Link>
            <div style={{ height: 1, background: 'var(--bd)', margin: '4px 6px' }} />
            <button
              onClick={handleSignOut}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5, fontSize: 12, color: 'var(--shf)', background: 'none', border: 'none', cursor: 'pointer', transition: 'background 100ms', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--shb)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              로그아웃
            </button>
          </div>
        )}

        {/* 푸터 행 */}
        <div className={`sb-foot${pathname === '/me' ? ' active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: show ? 8 : 0 }}>
          <Link
            href="/me"
            onClick={() => setMenuOpen(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit', overflow: 'hidden' }}
            title={!show ? (user?.name ?? '내 프로필') : undefined}
          >
            <div className="avatar" style={{ flexShrink: 0, overflow: 'hidden', padding: user?.avatarUrl ? 0 : undefined }}>
              {user?.avatarUrl
                ? <img src={user.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                : (user?.initials ?? '?')
              }
            </div>
            {show && (
              <div className="who" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <span className="n" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.name ?? '…'}
                </span>
                <span className="e" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.email ?? ''}
                </span>
              </div>
            )}
          </Link>
          {show && (
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
              title="메뉴"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: menuOpen ? 'var(--hs)' : 'var(--f4)', flexShrink: 0, display: 'flex', alignItems: 'center', borderRadius: 5, transition: 'color 100ms' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--f1)')}
              onMouseLeave={e => (e.currentTarget.style.color = menuOpen ? 'var(--hs)' : 'var(--f4)')}
            >
              <IcMore />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
