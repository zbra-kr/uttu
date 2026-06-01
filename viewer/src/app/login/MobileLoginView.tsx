'use client';
import React from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signIn } from '../auth/actions';

const WORDMARK_LIGHT = '/images/uttu/svg/uttu-wordmark.svg';
const WORDMARK_DARK  = '/images/uttu/svg/uttu-wordmark-white.svg';

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        height: 44, width: '100%', fontSize: 14, fontWeight: 600,
        background: 'var(--hs)', color: 'var(--rai)', border: 'none',
        borderRadius: 10, cursor: pending ? 'not-allowed' : 'pointer',
        opacity: pending ? 0.65 : 1, transition: 'opacity 150ms',
      }}
    >
      {pending ? '로그인 중…' : '로그인'}
    </button>
  );
}

export default function MobileLoginView() {
  const [state, action] = useFormState(signIn, null);
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    const saved = localStorage.getItem('uttu-theme');
    setIsDark(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: '24px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* 로고 */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img
            src={isDark ? WORDMARK_DARK : WORDMARK_LIGHT}
            alt="UTTU"
            style={{ height: 28, objectFit: 'contain' }}
          />
        </div>

        {/* 카피 */}
        <p style={{
          textAlign: 'center',
          color: 'var(--f3)',
          fontSize: 12,
          lineHeight: 1.8,
          margin: '0 0 28px',
          fontFamily: 'var(--mono)',
        }}>
          수메르 신화에서 실을 엮어 옷을 만든 여신, UTTU.<br />
          흩어진 데이터를 한 자리에 엮어 인사이트로 만듭니다.<br />
          B.CAVE 전 직원과 AI가 함께 짭니다.
        </p>

        <div style={{ background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 16, padding: '28px 24px' }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--f1)', letterSpacing: '-0.02em' }}>로그인</div>
            <div style={{ fontSize: 12, color: 'var(--f4)', marginTop: 4 }}>B.CAVE 메일계정으로 접속하세요</div>
          </div>

          <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--f3)' }}>이메일</label>
              <input
                name="email" type="email" required autoFocus autoComplete="email"
                placeholder="name@bcave.co.kr"
                style={{
                  height: 42, padding: '0 12px', borderRadius: 8, fontSize: 13,
                  border: '1px solid var(--bd)', background: 'var(--snk)',
                  color: 'var(--f1)', outline: 'none', width: '100%', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--f3)' }}>비밀번호</label>
              <input
                name="password" type="password" required autoComplete="current-password"
                placeholder="••••••••"
                style={{
                  height: 42, padding: '0 12px', borderRadius: 8, fontSize: 13,
                  border: '1px solid var(--bd)', background: 'var(--snk)',
                  color: 'var(--f1)', outline: 'none', width: '100%', boxSizing: 'border-box',
                }}
              />
            </div>

            {state?.error && (
              <div style={{ background: 'var(--shb)', border: '1px solid var(--shf)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--shf)' }}>
                {state.error}
              </div>
            )}

            <div style={{ marginTop: 4 }}>
              <SubmitBtn />
            </div>
          </form>

          <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'center', gap: 16 }}>
            <Link href="/signup" style={{ fontSize: 13, fontWeight: 500, color: 'var(--hs)', textDecoration: 'none' }}>
              계정 만들기
            </Link>
            <span style={{ color: 'var(--bd)', fontSize: 14 }}>·</span>
            <Link href="/forgot-password" style={{ fontSize: 13, fontWeight: 500, color: 'var(--hs)', textDecoration: 'none' }}>
              비밀번호 찾기
            </Link>
          </div>
        </div>

        <p style={{ fontSize: 11, color: 'var(--f4)', textAlign: 'center', marginTop: 20, lineHeight: 1.7 }}>
          ⓒ 2026 B.CAVE Corp. All rights reserved.
        </p>
      </div>
    </div>
  );
}
