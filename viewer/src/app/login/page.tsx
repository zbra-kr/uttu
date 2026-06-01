'use client';
import React from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signIn } from '../auth/actions';
import { useIsMobile } from '@/hooks/useViewport';
import MobileLoginView from './MobileLoginView';

const BCAVE_LOGO_LIGHT = '/images/bcave/logo.png';
const BCAVE_LOGO_DARK  = '/images/bcave/logo-white.png';
const WORDMARK_LIGHT = '/images/uttu/svg/uttu-wordmark.svg';
const WORDMARK_DARK  = '/images/uttu/svg/uttu-wordmark-white.svg';

function fmt(n: number): string {
  if (n >= 100_000) return `${Math.floor(n / 1000)}K+`;
  if (n >= 10_000)  return `${(n / 1000).toFixed(0)}K+`;
  return n.toLocaleString();
}

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        height: 40, width: '100%', fontSize: 13, fontWeight: 600,
        background: 'var(--hs)', color: '#fff', border: 'none',
        borderRadius: 7, cursor: pending ? 'not-allowed' : 'pointer',
        opacity: pending ? 0.65 : 1, transition: 'opacity 150ms',
      }}
    >
      {pending ? '로그인 중…' : '로그인'}
    </button>
  );
}

export default function LoginPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileLoginView />;
  return <LoginDesktopView />;
}

function LoginDesktopView() {
  const [state, action] = useFormState(signIn, null);
  const [stats, setStats] = React.useState<{ brands: number; products: number; reviews: number } | null>(null);
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  React.useEffect(() => {
    const saved = localStorage.getItem('uttu-theme');
    setIsDark(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);

  const STAT_ITEMS = [
    { value: stats ? fmt(stats.brands)   : '—', label: '브랜드' },
    { value: stats ? fmt(stats.products) : '—', label: '상품' },
    { value: stats ? fmt(stats.reviews)  : '—', label: '리뷰' },
  ];

  return (
    <div className="login-shell">
      <div style={{
        display: 'flex',
        background: 'var(--sur)',
        border: '0.5px solid var(--bs)',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 12px 56px rgba(0,0,0,0.1)',
        width: 780,
      }}>

        {/* ── 좌: 소개 패널 ── */}
        <div style={{
          width: 360, flexShrink: 0,
          padding: '52px 44px',
          background: 'var(--snk)',
          borderRight: '0.5px solid var(--bd)',
          display: 'flex', flexDirection: 'column',
        }}>
          <img src={isDark ? WORDMARK_DARK : WORDMARK_LIGHT} alt="UTTU" style={{ height: 26, objectFit: 'contain', objectPosition: 'left' }} />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '44px 0 36px' }}>
            <p style={{ fontSize: 11, color: 'var(--f4)', lineHeight: 1.7, margin: '0 0 22px', letterSpacing: '0.005em' }}>
              고대 바빌론, 실을 엮어 옷을 만든 여신 Uttu.
            </p>
            <p style={{ fontSize: 19, fontWeight: 700, color: 'var(--f1)', lineHeight: 1.45, letterSpacing: '-0.025em', margin: '0 0 18px' }}>
              흩어진 데이터를<br />한 자리에 엮어<br />인사이트로 만듭니다.
            </p>
            <p style={{ fontSize: 12, color: 'var(--hs)', fontWeight: 500, margin: 0, letterSpacing: '0.01em' }}>
              B.CAVE 모두를 위한 AI 데이터 도구.
            </p>
          </div>

          {/* 스탯 */}
          <div style={{ borderTop: '0.5px solid var(--bd)', paddingTop: 24, display: 'flex' }}>
            {STAT_ITEMS.map(({ value, label }, i) => (
              <div key={label} style={{
                flex: 1, textAlign: 'center',
                borderLeft: i > 0 ? '0.5px solid var(--bd)' : 'none',
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--f1)', letterSpacing: '-0.02em', minHeight: 24 }}>
                  {value}
                </div>
                <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 3, letterSpacing: '0.04em' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 우: 폼 패널 ── */}
        <div style={{
          flex: 1,
          padding: '52px 44px 28px',
          display: 'flex', flexDirection: 'column',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--f1)', letterSpacing: '-0.02em' }}>로그인</div>
            <div style={{ fontSize: 12, color: 'var(--f4)', marginTop: 4 }}>B.CAVE 메일계정으로 접속하세요</div>
          </div>

          <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 32 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)' }}>이메일</label>
              <input
                name="email" type="email" required autoFocus autoComplete="email"
                placeholder="name@bcave.co.kr"
                className="input mono"
                style={{ width: '100%', height: 38, fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)' }}>비밀번호</label>
              <input
                name="password" type="password" required autoComplete="current-password"
                placeholder="••••••••"
                className="input"
                style={{ width: '100%', height: 38 }}
              />
            </div>

            {state?.error && (
              <div style={{ background: 'var(--shb)', border: '0.5px solid var(--shf)', borderRadius: 6, padding: '9px 11px', fontSize: 12, color: 'var(--shf)' }}>
                {state.error}
              </div>
            )}

            <div style={{ marginTop: 4 }}>
              <SubmitBtn />
            </div>
          </form>

          {/* 하단 — 남은 공간 채우고 내부에서 최하단 정렬 */}
          <div style={{
            flex: 1, marginTop: 28,
            borderTop: '0.5px solid var(--bd)', paddingTop: 22,
            display: 'flex', flexDirection: 'column',
          }}>
            {/* 링크 — 우측 정렬 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
              <Link href="/signup" style={{ fontSize: 12, fontWeight: 500, color: 'var(--shf)', textDecoration: 'none' }}>
                계정 만들기
              </Link>
              <span style={{ color: 'var(--bd)', fontSize: 14, lineHeight: 1 }}>·</span>
              <Link href="/forgot-password" style={{ fontSize: 12, fontWeight: 500, color: 'var(--shf)', textDecoration: 'none' }}>
                비밀번호 찾기
              </Link>
            </div>

            {/* 카피라이트 — 최하단 */}
            <div style={{ marginTop: 'auto', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <img
                src={isDark ? BCAVE_LOGO_DARK : BCAVE_LOGO_LIGHT} alt="B.CAVE"
                style={{ height: 14, opacity: 0.35, objectFit: 'contain', objectPosition: 'left', display: 'block' }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              <p style={{ fontSize: 11, color: 'var(--f4)', lineHeight: 1.75, margin: 0, whiteSpace: 'nowrap' }}>
                본 시스템은 B.CAVE의 인가된 사용자에 한하여 접근 가능합니다.<br />
                비인가 접근 시 관련 법규에 의해 처벌될 수 있습니다.<br />
                ⓒ 2026 B.CAVE Corp. All rights reserved.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
