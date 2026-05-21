'use client';
import React from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import AiPanel from './AiPanel';
import CmdK from './CmdK';

const BREADCRUMBS: Record<string, string[]> = {
  '/':                ['홈', '대시보드'],
  '/ranking':         ['랭킹', '글로벌 상품'],
  '/anomaly':         ['이상탐지'],
  '/company':         ['회사', '코웰패션'],
  '/brand':           ['회사 · 코웰패션', '브랜드 · 커버낫'],
  '/product':         ['브랜드 · 커버낫', '시그니처 로고 스웻셔츠'],
  '/promo':           ['프로모션 / 세일'],
  '/snap':            ['스냅샷'],
  '/magazine':        ['매거진'],
  '/reviews':         ['리뷰'],
  '/matching':        ['자사 매칭'],
  '/admin':           ['매핑', '회사 ↔ 브랜드'],
  '/settings':        ['설정'],
  '/me':              ['마이페이지'],
};

const CONTEXTS: Record<string, string[]> = {
  '/':                ['전사 대시보드', '2026.05.20', '189 combos', '17 anomalies'],
  '/ranking':         ['글로벌 상품 랭킹', 'DAILY', '12,847 SKU'],
  '/anomaly':         ['이상탐지', '17 active', '7d window'],
  '/company':         ['회사 · 코웰패션', '033290', '5 brands', '1Q −18%'],
  '/brand':           ['브랜드 · 커버낫', '218 SKU', 'TOP100 14', '평균 랭킹 128'],
  '/product':         ['상품 · 시그니처 스웻 (8002)', '#02', '79,000원', '특이점 2'],
  '/promo':           ['프로모션 / 세일', '진행중 142+89'],
  '/snap':            ['스냅샷', '신규 38 (7일)'],
  '/magazine':        ['매거진', '신규 4 (7일)'],
  '/reviews':         ['자사 리뷰 · 30D', '184 신규', '평점 4.21', '저점 9'],
  '/matching':        ['자사 매칭', '확정 142', '대기 38'],
  '/admin':           ['공시 매핑', '대기 8', '완료 38'],
  '/settings':        ['설정'],
  '/me':              ['마이페이지'],
};

export default function ShellClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = React.useState<string>('light');
  const [aipOpen, setAipOpen] = React.useState(false);
  const [cmdkOpen, setCmdkOpen] = React.useState(false);
  const [sbCollapsed, setSbCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('uttu-theme') || 'light';
      setTheme(saved);
      document.documentElement.setAttribute('data-theme', saved);
    } catch {}
  }, []);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('uttu-sb-collapsed') === 'true';
      setSbCollapsed(saved);
      document.documentElement.style.setProperty('--sb-w', saved ? '48px' : '220px');
    } catch {}
  }, []);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('uttu-aip');
      setAipOpen(saved === 'open');
    } catch {}
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleTheme = (t: string) => {
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('uttu-theme', t); } catch {}
  };

  const toggleAip = () => {
    const next = !aipOpen;
    setAipOpen(next);
    try { localStorage.setItem('uttu-aip', next ? 'open' : 'closed'); } catch {}
  };

  const toggleSb = () => {
    const next = !sbCollapsed;
    setSbCollapsed(next);
    document.documentElement.style.setProperty('--sb-w', next ? '48px' : '220px');
    try { localStorage.setItem('uttu-sb-collapsed', String(next)); } catch {}
  };

  const breadcrumb = BREADCRUMBS[pathname] || ['UTTU'];
  const context = CONTEXTS[pathname] || ['UTTU'];

  return (
    <>
      <div className="shell">
        <Sidebar collapsed={sbCollapsed} onToggle={toggleSb} />
        <main className="main">
          <Topbar
            breadcrumb={breadcrumb}
            theme={theme}
            onTheme={handleTheme}
            aipOpen={aipOpen}
            onToggleAip={toggleAip}
            onOpenCmdk={() => setCmdkOpen(true)}
          />
          <div className="main-body">{children}</div>
        </main>
        <AiPanel open={aipOpen} onToggle={toggleAip} context={context} route={pathname} />
      </div>
      <CmdK open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </>
  );
}
