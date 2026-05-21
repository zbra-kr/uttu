'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { IcSearch, IcBell, IcSpark, IcChevL } from '../ui/icons';

interface TopbarProps {
  breadcrumb: string[];
  theme: string;
  onTheme: (t: string) => void;
  aipOpen: boolean;
  onToggleAip: () => void;
  onOpenCmdk: () => void;
}

export default function Topbar({ breadcrumb, theme, onTheme, aipOpen, onToggleAip, onOpenCmdk }: TopbarProps) {
  const router = useRouter();

  return (
    <header className="tb">
      <button className="back-btn" onClick={() => router.back()} title="이전 화면으로 돌아가기">
        <span className="arrow">←</span>
        <span className="from">BACK</span>
      </button>
      <nav className="bc">
        {breadcrumb.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={`crumb ${i === breadcrumb.length - 1 ? 'last' : ''}`}>{b}</span>
          </React.Fragment>
        ))}
      </nav>
      <div className="search" onClick={onOpenCmdk}>
        <IcSearch />
        <span className="placeholder">회사·브랜드·상품 검색</span>
        <span className="kbd">⌘K</span>
      </div>
      <div className="theme">
        <button aria-pressed={theme === 'light'} onClick={() => onTheme('light')}>light</button>
        <button aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}>dark</button>
      </div>
      <button className="icon-btn" title="알림"><IcBell /></button>
      {!aipOpen && (
        <button className="icon-btn" onClick={onToggleAip} title="UTTU AI 열기"
          style={{ background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)' }}>
          <IcSpark />
        </button>
      )}
    </header>
  );
}
