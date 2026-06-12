'use client';
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IcSearch, IcBell, IcSpark, IcChevL } from '../ui/icons';
import { fetchUnreadCount } from '@/lib/queries-me';
import InboxList from '../me/InboxList';

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
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [bellOpen, setBellOpen] = React.useState(false);
  const bellRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    fetchUnreadCount().then(setUnreadCount);
    const id = setInterval(() => fetchUnreadCount().then(setUnreadCount), 30000);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    if (!bellOpen) return;
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bellOpen]);

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
      <button type="button" className="search" onClick={onOpenCmdk}>
        <IcSearch />
        <span className="placeholder">회사·브랜드·상품 검색</span>
        <span className="kbd">⌘K</span>
      </button>
      <div className="theme">
        <button aria-pressed={theme === 'light'} onClick={() => onTheme('light')}>light</button>
        <button aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}>dark</button>
      </div>
      <div ref={bellRef} style={{ position: 'relative' }}>
        <button
          className="icon-btn"
          title="알림"
          onClick={() => setBellOpen(o => !o)}
          style={{ position: 'relative' }}
        >
          <IcBell />
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 2,
              minWidth: 14, height: 14, borderRadius: 7,
              padding: '0 3px',
              background: 'var(--shf)', color: 'var(--white)',
              fontSize: 9, fontFamily: 'var(--mono)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, pointerEvents: 'none',
            }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        {bellOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            width: 320,
            background: 'var(--sur)',
            border: '0.5px solid var(--bd)',
            borderRadius: 'var(--r-4)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            zIndex: 200,
            overflow: 'hidden',
          }}>
            <div className="row-flex between center" style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--bs)' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>알림</span>
              <Link href="/me" className="btn sm" onClick={() => setBellOpen(false)}>전체 보기</Link>
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              <InboxList limit={7} compact onUnreadChange={setUnreadCount} />
            </div>
          </div>
        )}
      </div>
      {!aipOpen && (
        <button className="icon-btn" onClick={onToggleAip} title="UTTU AI 열기"
          style={{ background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)' }}>
          <IcSpark />
        </button>
      )}
    </header>
  );
}
