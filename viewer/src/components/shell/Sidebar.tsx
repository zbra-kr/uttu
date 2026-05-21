'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UttuMark, IcHome, IcRanking, IcFlag, IcCompany, IcBrand, IcProduct, IcPromo, IcSnap, IcBook, IcReview, IcLink, IcMapping, IcSettings, IcMore, IcChevL, IcChevR } from '../ui/icons';

const ROUTES = [
  { id: 'home',     path: '/',          label: '홈',       Icon: IcHome,     section: 'main' },
  { id: 'ranking',  path: '/ranking',   label: '랭킹',     Icon: IcRanking,  section: 'main' },
  { id: 'anomaly',  path: '/anomaly',   label: '이상탐지', Icon: IcFlag,     section: 'main' },
  { id: 'company',  path: '/company',   label: '회사',     Icon: IcCompany,  section: 'main' },
  { id: 'brand',    path: '/brand',     label: '브랜드',   Icon: IcBrand,    section: 'main' },
  { id: 'product',  path: '/product',   label: '상품',     Icon: IcProduct,  section: 'main' },
  { id: 'promo',    path: '/promo',     label: '프로모션', Icon: IcPromo,    section: 'main' },
  { id: 'snap',     path: '/snap',      label: '스냅샷',   Icon: IcSnap,     section: 'main' },
  { id: 'magazine', path: '/magazine',  label: '매거진',   Icon: IcBook,     section: 'main' },
  { id: 'reviews',  path: '/reviews',   label: '리뷰',     Icon: IcReview,   section: 'main' },
  { id: 'matching', path: '/matching',  label: '자사 매칭', Icon: IcLink,    section: 'main' },
  { id: 'mapping',  path: '/admin/mapping', label: '매핑', Icon: IcMapping,  section: 'admin' },
  { id: 'settings', path: '/settings',  label: '설정',     Icon: IcSettings, section: 'admin' },
];

const NAV_COUNTS: Record<string, number> = {
  home: 17,
  anomaly: 17,
  promo: 142,
  snap: 38,
  magazine: 4,
  reviews: 184,
  mapping: 8,
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const [hovering, setHovering] = React.useState(false);

  const isPeek = collapsed && hovering;
  const show = !collapsed || hovering;

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  const main = ROUTES.filter(r => r.section === 'main');
  const admin = ROUTES.filter(r => r.section === 'admin');

  return (
    <aside
      className={`sb${collapsed && !hovering ? ' collapsed' : ''}`}
      onMouseEnter={() => collapsed && setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={isPeek ? {
        position: 'fixed',
        top: 0, left: 0,
        height: '100vh',
        width: 220,
        zIndex: 50,
        boxShadow: '4px 0 24px rgba(0,0,0,0.12)',
      } : undefined}
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
        {main.map(r => (
          <Link
            key={r.id}
            href={r.path}
            className={`sb-item ${isActive(r.path) ? 'active' : ''}`}
            title={!show ? r.label : undefined}
          >
            <r.Icon />
            {show && <span>{r.label}</span>}
            {show && NAV_COUNTS[r.id] && <span className="num">{NAV_COUNTS[r.id]}</span>}
          </Link>
        ))}
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
