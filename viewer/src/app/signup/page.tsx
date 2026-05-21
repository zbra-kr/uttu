'use client';
import React from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signUp } from '../auth/actions';

const BCAVE_LOGO_LIGHT = '/images/bcave/logo.png';
const BCAVE_LOGO_DARK  = '/images/bcave/logo-white.png';
const WORDMARK_LIGHT = '/images/uttu/svg/uttu-wordmark.svg';
const WORDMARK_DARK  = '/images/uttu/svg/uttu-wordmark-white.svg';

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
      {pending ? '처리 중…' : '계정 만들기'}
    </button>
  );
}

export default function SignupPage() {
  const [state, action] = useFormState(signUp, null);
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    const saved = localStorage.getItem('uttu-theme');
    setIsDark(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);

  return (
    <div className="login-shell">
      <div style={{
        width: 420,
        background: 'var(--sur)',
        border: '0.5px solid var(--bs)',
        borderRadius: 16,
        padding: '48px 44px 28px',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 12px 56px rgba(0,0,0,0.1)',
      }}>
        <img src={isDark ? WORDMARK_DARK : WORDMARK_LIGHT} alt="UTTU" style={{ height: 26, objectFit: 'contain', objectPosition: 'left' }} />

        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--f1)', letterSpacing: '-0.02em' }}>계정 만들기</div>
          <div style={{ fontSize: 12, color: 'var(--f4)', marginTop: 4 }}>B.CAVE 메일계정으로 가입하세요</div>
        </div>

        {state?.success ? (
          <div style={{
            marginTop: 28,
            background: 'color-mix(in srgb, var(--slf) 10%, transparent)',
            border: '0.5px solid color-mix(in srgb, var(--slf) 40%, transparent)',
            borderRadius: 8, padding: '16px', fontSize: 13, color: 'var(--f2)', lineHeight: 1.6,
          }}>
            {state.success}
            <div style={{ marginTop: 12 }}>
              <Link href="/login" style={{ fontSize: 12, fontWeight: 500, color: 'var(--shf)', textDecoration: 'none' }}>
                로그인으로 →
              </Link>
            </div>
          </div>
        ) : (
          <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 28 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)' }}>이름</label>
              <input
                name="full_name" type="text" autoComplete="name"
                placeholder="홍길동"
                className="input"
                style={{ width: '100%', height: 38 }}
              />
            </div>
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
                name="password" type="password" required autoComplete="new-password"
                placeholder="최소 8자"
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
        )}

        <div style={{ marginTop: 24, borderTop: '0.5px solid var(--bd)', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Link href="/login" style={{ fontSize: 12, color: 'var(--f3)', textDecoration: 'none' }}>
            ← 로그인으로 돌아가기
          </Link>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <img
              src={isDark ? BCAVE_LOGO_DARK : BCAVE_LOGO_LIGHT} alt="B.CAVE"
              style={{ height: 14, opacity: 0.35, objectFit: 'contain', objectPosition: 'left', display: 'block' }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            <p style={{ fontSize: 11, color: 'var(--f4)', lineHeight: 1.75, margin: 0 }}>
              ⓒ 2026 B.CAVE Corp. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
