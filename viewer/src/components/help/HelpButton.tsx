'use client';
import React from 'react';
import { usePathname } from 'next/navigation';
import { IcHelp } from '../ui/icons';
import HelpDrawer from './HelpDrawer';

export default function HelpButton() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // 동적 세그먼트 제거: /admin/guides/abc123 → /admin/guides
  // 단순 처리: 쿼리스트링은 usePathname에서 이미 제거됨
  const pagePath = pathname ?? null;

  const toggle = () => setOpen(o => !o);

  return (
    <>
      <button
        onClick={toggle}
        title={open ? '가이드 닫기 (ESC)' : '이 화면 가이드 열기'}
        style={{
          width: 28, height: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'var(--hs-soft)' : 'none',
          border: 'none',
          cursor: 'pointer',
          borderRadius: 'var(--r-2)',
          color: open ? 'var(--hs)' : 'var(--f2)',
          transition: 'color 100ms, background 100ms',
          flexShrink: 0,
        }}
        onMouseEnter={e => {
          const el = e.currentTarget;
          if (!open) el.style.color = 'var(--f1)';
        }}
        onMouseLeave={e => {
          const el = e.currentTarget;
          if (!open) el.style.color = 'var(--f2)';
        }}
      >
        <IcHelp size={16} />
      </button>

      <HelpDrawer pagePath={pagePath} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
