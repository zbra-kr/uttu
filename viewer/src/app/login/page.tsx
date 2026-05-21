'use client';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signIn } from '../auth/actions';

const LOGO = 'https://ogtrvberttzupxrffpoh.supabase.co/storage/v1/object/public/For%20email%20format/bcave_logo.png';

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
        letterSpacing: '0.01em',
      }}
    >
      {pending ? '로그인 중…' : '로그인'}
    </button>
  );
}

export default function LoginPage() {
  const [state, action] = useFormState(signIn, null);

  return (
    <div className="login-shell">
      <div style={{
        width: 400,
        background: 'var(--sur)',
        border: '0.5px solid var(--bs)',
        borderRadius: 16,
        padding: '48px 44px 36px',
        display: 'flex', flexDirection: 'column', gap: 28,
        boxShadow: '0 8px 40px rgba(0,0,0,0.07)',
      }}>

        {/* 로고 + 타이틀 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <img
            src={LOGO}
            alt="B.CAVE"
            style={{ height: 22 }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--f1)', letterSpacing: '-0.02em' }}>
              로그인
            </div>
            <div style={{ fontSize: 12, color: 'var(--f4)', marginTop: 4 }}>
              B.CAVE 계정으로 접속하세요
            </div>
          </div>
        </div>

        <div style={{ height: 0, borderTop: '0.5px solid var(--bd)' }} />

        {/* 폼 */}
        <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)' }}>이메일</label>
            <input
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="name@bcave.co.kr"
              className="input mono"
              style={{ width: '100%', height: 38, fontSize: 12 }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)' }}>비밀번호</label>
              <Link href="/forgot-password" style={{ fontSize: 11, color: 'var(--hs)', textDecoration: 'none', opacity: 0.85 }}>
                비밀번호 찾기
              </Link>
            </div>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              placeholder="••••••••"
              style={{ width: '100%', height: 38 }}
            />
          </div>

          {state?.error && (
            <div style={{
              background: 'var(--shb)',
              border: '0.5px solid var(--shf)',
              borderRadius: 6, padding: '9px 11px',
              fontSize: 12, color: 'var(--shf)',
            }}>
              {state.error}
            </div>
          )}

          <div style={{ marginTop: 4 }}>
            <SubmitBtn />
          </div>
        </form>

        {/* 하단 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Link href="/signup" style={{ fontSize: 12, color: 'var(--f3)', textDecoration: 'none' }}>
            계정 만들기
          </Link>
          <p style={{
            fontSize: 10, color: 'var(--f4)', textAlign: 'center',
            lineHeight: 1.65, margin: 0,
          }}>
            본 시스템은 B.CAVE의 인가된 사용자에 한하여 접근 가능합니다.<br />
            비인가 접근 시 관련 법규에 의해 처벌될 수 있습니다.<br />
            ⓒ 2026 B.CAVE Corp. All rights reserved.
          </p>
        </div>

      </div>
    </div>
  );
}
