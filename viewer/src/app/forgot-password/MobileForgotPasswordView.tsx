'use client';
import React from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { resetPassword } from '../auth/actions';

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
      {pending ? '전송 중…' : '재설정 링크 보내기'}
    </button>
  );
}

export default function MobileForgotPasswordView() {
  const [state, action] = useFormState(resetPassword, null);
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
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src={isDark ? WORDMARK_DARK : WORDMARK_LIGHT}
            alt="UTTU"
            style={{ height: 28, objectFit: 'contain' }}
          />
        </div>

        <div style={{ background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 16, padding: '28px 24px' }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--f1)', letterSpacing: '-0.02em' }}>비밀번호 찾기</div>
            <div style={{ fontSize: 12, color: 'var(--f4)', marginTop: 4 }}>가입한 이메일로 재설정 링크를 보내드립니다</div>
          </div>

          {state?.success ? (
            <div style={{
              background: 'var(--slb)', border: '1px solid var(--slf)',
              borderRadius: 10, padding: 16, fontSize: 13, color: 'var(--f2)', lineHeight: 1.6,
            }}>
              {state.success}
              <div style={{ marginTop: 12 }}>
                <Link href="/login" style={{ fontSize: 12, fontWeight: 500, color: 'var(--hs)', textDecoration: 'none' }}>
                  로그인으로 →
                </Link>
              </div>
            </div>
          ) : (
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

              {state?.error && (
                <div style={{ background: 'var(--shb)', border: '1px solid var(--shf)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--shf)' }}>
                  {state.error}
                </div>
              )}

              <div style={{ marginTop: 4 }}>
                <SubmitBtn />
              </div>
            </form>
          )}

          <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--bd)', textAlign: 'center' }}>
            <Link href="/login" style={{ fontSize: 13, fontWeight: 500, color: 'var(--hs)', textDecoration: 'none' }}>
              ← 로그인으로 돌아가기
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
