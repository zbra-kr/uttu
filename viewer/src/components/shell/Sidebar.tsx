'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UttuMark, IcHome, IcRanking, IcBrandRanking, IcFlag, IcCompany, IcBrand, IcProduct, IcPromo, IcSnap, IcBook, IcReview, IcLink, IcMapping, IcSettings, IcMore, IcChevL, IcChevR, IcChevD } from '../ui/icons';

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
}

const GROUP_PARENTS = new Set(ROUTES.filter(r => r.parent).map(r => r.parent!));

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const [hovering, setHovering] = React.useState(false);

  const isPeek = collapsed && hovering;
  const show = !collapsed || hovering;

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname === path || pathname.startsWith(path + '/');
  };

  // 현재 활성화된 하위 항목의 부모 그룹은 기본으로 열기
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

  const main = ROUTES.filter(r => r.section === 'main');
  const admin = ROUTES.filter(r => r.section === 'admin');

  return (
    <aside
      className={`sb${collapsed && !hovering ? ' collapsed' : ''}${isPeek ? ' peek' : ''}`}
      onMouseEnter={() => collapsed && setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="sb-brand">
        {show && <UttuMark size={1.1} color="var(--hs)" />}
        {show && <span className="sb-brand-text">b.cave</span>}
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
          const isSub = !!r.parent;
          const isParent = GROUP_PARENTS.has(r.id);
          const isOpen = open.has(r.id);
          // 하위 항목: 부모가 열려있을 때만 표시 (접힌 사이드바는 CSS로 숨김)
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

      <Link href="/me" className={`sb-foot ${pathname === '/me' ? 'active' : ''}`} title={!show ? '마이페이지' : undefined}>
        <div className="avatar">JH</div>
        {show && (
          <>
            <div className="who">
              <span className="n">정호철</span>
              <span className="e">zbra@zbra.co.kr</span>
            </div>
            <IcMore />
          </>
        )}
      </Link>
    </aside>
  );
}
