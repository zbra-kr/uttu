'use client';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { resetPassword } from '../auth/actions';

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
      }}
    >
      {pending ? '전송 중…' : '재설정 링크 보내기'}
    </button>
  );
}

export default function ForgotPasswordPage() {
  const [state, action] = useFormState(resetPassword, null);

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
              비밀번호 재설정
            </div>
            <div style={{ fontSize: 12, color: 'var(--f4)', marginTop: 4 }}>
              가입 이메일로 재설정 링크를 보내드립니다
            </div>
          </div>
        </div>

        <div style={{ height: 0, borderTop: '0.5px solid var(--bd)' }} />

        {state?.success ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: 'color-mix(in srgb, var(--slf) 12%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20,
            }}>
              ✓
            </div>
            <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--f2)', lineHeight: 1.6 }}>
              {state.success}
            </div>
          </div>
        ) : (
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

            {state?.error && (
              <div style={{
                background: 'var(--shb)', border: '0.5px solid var(--shf)',
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
        )}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Link href="/login" style={{ fontSize: 12, color: 'var(--f3)', textDecoration: 'none' }}>
            ← 로그인으로 돌아가기
          </Link>
        </div>

      </div>
    </div>
  );
}
