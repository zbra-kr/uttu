'use client';
import React from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import AiPanel from './AiPanel';
import CmdK from './CmdK';
import { fetchShellStats, ShellStats } from '@/lib/queries';

const BREADCRUMBS: Record<string, string[]> = {
  '/':                ['홈', '대시보드'],
  '/ranking':         ['랭킹', '글로벌 상품'],
  '/anomaly':         ['이상탐지'],
  '/company':         ['회사'],
  '/brand':           ['브랜드'],
  '/product':         ['상품'],
  '/promo':           ['프로모션 / 세일'],
  '/snap':            ['스냅샷'],
  '/magazine':        ['매거진'],
  '/reviews':         ['리뷰'],
  '/matching':        ['자사 매칭'],
  '/admin':           ['매핑', '회사 ↔ 브랜드'],
  '/admin/mapping':   ['매핑', 'Corp Code'],
  '/settings':        ['설정'],
  '/me':              ['마이페이지'],
};

const CONTEXTS: Record<string, string[]> = {
  '/':          ['전사 대시보드'],
  '/ranking':   ['글로벌 상품 랭킹', 'DAILY'],
  '/anomaly':   ['이상탐지'],
  '/company':   ['회사 조회'],
  '/brand':     ['브랜드 조회'],
  '/product':   ['상품 조회'],
  '/promo':     ['프로모션 / 세일'],
  '/snap':      ['스냅샷'],
  '/magazine':  ['매거진'],
  '/reviews':   ['자사 리뷰'],
  '/matching':  ['자사 매칭'],
  '/admin':     ['공시 매핑'],
  '/settings':  ['설정'],
  '/me':        ['마이페이지'],
};

export default function ShellClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = React.useState<string>('light');
  const [productCrumb, setProductCrumb] = React.useState<{ brand: string; name: string } | null>(null);
  const [brandCrumb,   setBrandCrumb]   = React.useState<{ company: string; name: string } | null>(null);
  const [aipOpen, setAipOpen] = React.useState(false);
  const [cmdkOpen, setCmdkOpen] = React.useState(false);
  const [sbCollapsed, setSbCollapsed] = React.useState(false);
  const [shellStats,  setShellStats]  = React.useState<ShellStats | null>(null);
  const [pageAiCtx,  setPageAiCtx]  = React.useState<string[] | null>(null);

  React.useEffect(() => {
    fetchShellStats().then(setShellStats).catch(() => {});
  }, []);

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
    const handler = (e: Event) => {
      const { brand, name } = (e as CustomEvent).detail;
      setProductCrumb((brand || name) ? { brand, name } : null);
    };
    window.addEventListener('uttu:crumb', handler);
    return () => window.removeEventListener('uttu:crumb', handler);
  }, []);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const { company, name } = (e as CustomEvent).detail;
      setBrandCrumb(name ? { company, name } : null);
    };
    window.addEventListener('uttu:brand-crumb', handler);
    return () => window.removeEventListener('uttu:brand-crumb', handler);
  }, []);

  React.useEffect(() => {
    if (pathname !== '/product') setProductCrumb(null);
    if (pathname !== '/brand')   setBrandCrumb(null);
    setPageAiCtx(null);
  }, [pathname]);

  React.useEffect(() => {
    const handler = (e: Event) => setPageAiCtx((e as CustomEvent<string[]>).detail);
    window.addEventListener('uttu:ai-context', handler);
    return () => window.removeEventListener('uttu:ai-context', handler);
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

  // productCrumb.brand 가 회사명으로도 사용됨 (company 페이지)
  const breadcrumb =
    pathname === '/product' && productCrumb && productCrumb.name
      ? [`브랜드 · ${productCrumb.brand}`, productCrumb.name]
      : pathname === '/company' && productCrumb && productCrumb.brand
        ? [`회사 · ${productCrumb.brand}`]
        : pathname === '/brand' && brandCrumb
          ? brandCrumb.company
            ? [`회사 · ${brandCrumb.company}`, `브랜드 · ${brandCrumb.name}`]
            : [`브랜드 · ${brandCrumb.name}`]
          : (BREADCRUMBS[pathname] || ['UTTU']);

  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const a       = shellStats?.anomalyCount ?? 0;
  const rv      = shellStats?.reviewTotal ?? 0;
  const rvAvg   = shellStats ? shellStats.reviewAvgRating.toFixed(2) : null;
  const rvLow   = shellStats?.reviewLowCount ?? 0;
  const snap    = shellStats?.snapNew7d ?? 0;
  const mag     = shellStats?.magazineNew7d ?? 0;
  const promo   = shellStats?.promoActiveCount ?? 0;

  const dynamicContexts: Record<string, string[]> = {
    ...CONTEXTS,
    '/':         ['전사 대시보드', todayStr, ...(a > 0 ? [`${a} anomalies`] : [])],
    '/anomaly':  ['이상탐지', `${a} active`, '7d window'],
    '/promo':    ['프로모션 / 세일', promo > 0 ? `진행중 ${promo}` : '진행중 없음'],
    '/snap':     ['스냅샷', snap > 0 ? `신규 ${snap} (7일)` : '신규 없음'],
    '/magazine': ['매거진', mag > 0 ? `신규 ${mag} (7일)` : '신규 없음'],
    '/reviews':  [
      '자사 리뷰 · 30D',
      ...(rv > 0 ? [`${rv} 신규`] : []),
      ...(rvAvg ? [`평점 ${rvAvg}`] : []),
      ...(rvLow > 0 ? [`저점 ${rvLow}`] : []),
    ],
  };
  // 페이지가 uttu:ai-context 이벤트로 실시간 컨텍스트를 제공하면 그것을 우선 사용
  const context = pageAiCtx ?? (dynamicContexts[pathname] || ['UTTU']);

  const navCounts: Record<string, number> = {
    home:     a,
    anomaly:  a,
    promo,
    snap,
    magazine: mag,
    reviews:  rv,
  };

  return (
    <>
      <div className="shell">
        <Sidebar collapsed={sbCollapsed} onToggle={toggleSb} theme={theme} navCounts={navCounts} />
        <main className="main">
          <Topbar
            breadcrumb={breadcrumb}
            theme={theme}
            onTheme={handleTheme}
            aipOpen={aipOpen}
            onToggleAip={toggleAip}
            onOpenCmdk={() => setCmdkOpen(true)}
          />
          <div className="main-body">
            {children}
            <footer style={{
              marginTop: 'auto', paddingTop: 28,
              borderTop: '0.5px solid var(--bd)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <img
                src={theme === 'dark' ? '/images/bcave/logo-white.png' : '/images/bcave/logo.png'}
                alt="B.CAVE"
                style={{ height: 12, opacity: 0.35, objectFit: 'contain', display: 'block' }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              <span style={{ fontSize: 10, color: 'var(--f4)', letterSpacing: '0.01em' }}>
                ⓒ 2026 B.CAVE Corp. All rights reserved.
              </span>
            </footer>
          </div>
        </main>
        <AiPanel open={aipOpen} onToggle={toggleAip} context={context} route={pathname} />
      </div>
      <CmdK open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </>
  );
}
