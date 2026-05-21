'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { IcHome, IcRanking, IcBrandRanking, IcFlag, IcCompany, IcBrand, IcProduct, IcPromo, IcSnap, IcBook, IcReview, IcLink, IcMapping, IcSettings, IcMore, IcChevL, IcChevR, IcChevD } from '../ui/icons';

const ROUTES = [
  { id: 'home',         path: '/',             label: '홈',        Icon: IcHome,        section: 'main' },
  { id: 'ranking',      path: '/ranking',      label: '상품 랭킹',  Icon: IcRanking,     section: 'main' },
  { id: 'product',      path: '/product',      label: '상품',      Icon: IcProduct,     section: 'main', parent: 'ranking' },
  { id: 'brand-ranking',path: '/brand-ranking',label: '브랜드 랭킹',Icon: IcBrandRanking,section: 'main' },
  { id: 'brand',        path: '/brand',        label: '브랜드',     Icon: IcBrand,       section: 'main', parent: 'brand-ranking' },
  { id: 'anomaly',      path: '/anomaly',      label: '이상탐지',   Icon: IcFlag,        section: 'main' },
  { id: 'company',      path: '/company',      label: '회사',      Icon: IcCompany,     section: 'main' },
  { id: 'promo',        path: '/promo',        label: '프로모션',   Icon: IcPromo,       section: 'main' },
  { id: 'snap',         path: '/snap',         label: '스냅샷',     Icon: IcSnap,        section: 'main' },
  { id: 'magazine',     path: '/magazine',     label: '매거진',     Icon: IcBook,        section: 'main' },
  { id: 'reviews',      path: '/reviews',      label: '리뷰',      Icon: IcReview,      section: 'main' },
  { id: 'matching',     path: '/matching',     label: '자사 매칭',  Icon: IcLink,        section: 'main' },
  { id: 'mapping',      path: '/admin/mapping',label: '매핑',      Icon: IcMapping,     section: 'admin' },
  { id: 'settings',     path: '/settings',     label: '설정',      Icon: IcSettings,    section: 'admin' },
];

const NAV_COUNTS: Record<string, number> = {
  home: 17,
  anomaly: 17,
  promo: 142,
  snap: 38,
  magazine: 4,
  reviews: 184,
  mapping: 912,
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  theme: string;
}

const GROUP_PARENTS = new Set(ROUTES.filter(r => r.parent).map(r => r.parent!));

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Sidebar({ collapsed, onToggle, theme }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const [hovering, setHovering] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [user, setUser] = React.useState<{ name: string; email: string; initials: string } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const isPeek = collapsed && hovering;
  const show = !collapsed || hovering;

  // 로그인 유저 정보
  React.useEffect(() => {
    supabaseBrowser().auth.getUser().then(({ data }) => {
      if (!data.user) return;
      const email = data.user.email ?? '';
      const name  = (data.user.user_metadata?.full_name as string | undefined)
        || email.split('@')[0];
      setUser({ name, email, initials: getInitials(name) });
    });
  }, []);

  // 외부 클릭 시 메뉴 닫기
  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
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

  const toggleGroup = (id: string) => {
    setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const main  = ROUTES.filter(r => r.section === 'main');
  const admin = ROUTES.filter(r => r.section === 'admin');

  return (
    <aside
      className={`sb${collapsed && !hovering ? ' collapsed' : ''}${isPeek ? ' peek' : ''}`}
      onMouseEnter={() => collapsed && setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="sb-brand">
        {show && (
          <img
            src={theme === 'dark'
              ? '/images/uttu/svg/uttu-wordmark-white.svg'
              : '/images/uttu/svg/uttu-wordmark.svg'}
            alt="UTTU"
            style={{ height: 22, objectFit: 'contain', objectPosition: 'left', flexShrink: 0 }}
          />
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
        {main.map(r => {
          const isSub    = !!r.parent;
          const isParent = GROUP_PARENTS.has(r.id);
          const isOpen   = open.has(r.id);
          if (isSub && !open.has(r.parent!)) return null;
          return (
            <div key={r.id} style={{ position: 'relative' }}>
              <Link
                href={r.path}
                className={`sb-item${isSub ? ' sub' : ''} ${isActive(r.path) ? 'active' : ''}`}
                title={!show ? r.label : undefined}
              >
                <r.Icon size={isSub ? 13 : 16} />
                {show && <span>{r.label}</span>}
                {show && NAV_COUNTS[r.id] && <span className="num">{NAV_COUNTS[r.id]}</span>}
              </Link>
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
          );
        })}
      </nav>

      {show && <div className="sb-section">admin</div>}
      <nav className="sb-nav">
        {admin.map(r => (
          <Link
            key={r.id}
            href={r.path}
            className={`sb-item ${isActive(r.path) ? 'active' : ''}`}
            title={!show ? r.label : undefined}
          >
            <r.Icon />
            {show && <span>{r.label}</span>}
          </Link>
        ))}
      </nav>

      {/* 하단 유저 영역 */}
      <div ref={menuRef} style={{ position: 'relative', marginTop: 'auto' }}>

        {/* 드롭업 메뉴 */}
        {menuOpen && show && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
            background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8,
            padding: 4, zIndex: 200,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
          }}>
            <Link
              href="/me"
              onClick={() => setMenuOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, fontSize: 12, color: 'var(--f1)', textDecoration: 'none', transition: 'background 100ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--snk)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              내 프로필
            </Link>
            <Link
              href="/me?tab=password"
              onClick={() => setMenuOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, fontSize: 12, color: 'var(--f1)', textDecoration: 'none', transition: 'background 100ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--snk)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              비밀번호 변경
            </Link>
            <div style={{ height: 1, background: 'var(--bd)', margin: '4px 6px' }} />
            <button
              onClick={handleSignOut}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, fontSize: 12, color: 'var(--shf)', background: 'none', border: 'none', cursor: 'pointer', transition: 'background 100ms', textAlign: 'left' }}
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
            <div className="avatar" style={{ flexShrink: 0 }}>{user?.initials ?? '?'}</div>
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
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: menuOpen ? 'var(--hs)' : 'var(--f4)', flexShrink: 0, display: 'flex', alignItems: 'center', borderRadius: 4, transition: 'color 100ms' }}
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
