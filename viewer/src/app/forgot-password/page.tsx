'use client';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { resetPassword } from '../auth/actions';

const LOGO = 'https://ogtrvberttzupxrffpoh.supabase.co/storage/v1/object/public/For%20email%20format/bcave_logo_w.png';

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        height: 42, width: '100%', fontSize: 13, fontWeight: 600,
        background: 'var(--hs)', color: '#fff', border: 'none',
        borderRadius: 8, cursor: pending ? 'not-allowed' : 'pointer',
        opacity: pending ? 0.7 : 1, transition: 'opacity 150ms',
      }}
    >
      {pending ? '전송 중…' : '재설정 링크 보내기'}
    </button>
  );
}

export default function ForgotPasswordPage() {
  const [state, action] = useFormState(resetPassword, null);

  return (
    <div style={{ height: '100vh', display: 'flex', fontFamily: 'inherit', overflow: 'hidden' }}>

      {/* ── 좌: 브랜드 패널 ── */}
      <div style={{
        width: 420, flexShrink: 0,
        background: '#0a0e1a',
        display: 'flex', flexDirection: 'column',
        padding: '52px 48px',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.035) 0.8px, transparent 0.8px)',
        backgroundSize: '18px 18px',
      }}>
        <div>
          <img
            src={LOGO}
            alt="B.CAVE"
            style={{ height: 26, opacity: 0.88 }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
        <div style={{ marginTop: 'auto', marginBottom: 'auto', paddingTop: 40, paddingBottom: 40 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', marginBottom: 20 }}>
            Fashion Intelligence Platform
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', lineHeight: 1.3, letterSpacing: '-0.02em' }}>
            비밀번호를<br />잊으셨나요?
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.42)', marginTop: 18, lineHeight: 1.75 }}>
            가입 시 사용한 이메일을 입력하시면<br />재설정 링크를 보내드립니다
          </div>
        </div>
        <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.2)', lineHeight: 1.7, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20 }}>
          본 시스템은 B.CAVE의 인가된 사용자에 한하여 접근 가능하며, 비인가자 및 불법적인 접근을
          시도하는 경우 관련 법규에 의해 처벌될 수 있습니다.<br />
          ⓒ 2026 B.CAVE Corp. All rights reserved.
        </div>
      </div>

      {/* ── 우: 폼 패널 ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', padding: '60px 48px',
      }}>
        <div style={{ width: '100%', maxWidth: 360 }}>

          <div style={{ marginBottom: 36 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--f1)', letterSpacing: '-0.02em' }}>
              비밀번호 재설정
            </div>
            <div style={{ fontSize: 13, color: 'var(--f4)', marginTop: 6 }}>
              가입 이메일로 재설정 링크를 발송합니다
            </div>
          </div>

          {state?.success ? (
            <div style={{
              background: 'color-mix(in srgb, var(--slf) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--slf) 40%, transparent)',
              borderRadius: 8, padding: '16px',
              fontSize: 13, color: 'var(--slf)', lineHeight: 1.6,
            }}>
              ✓ {state.success}
            </div>
          ) : (
            <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--f2)' }}>이메일</label>
                <input
                  name="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder="name@bcave.co.kr"
                  className="input mono"
                  style={{ width: '100%', height: 42, fontSize: 13, borderRadius: 8 }}
                />
              </div>

              {state?.error && (
                <div style={{
                  background: 'var(--shb)',
                  border: '1px solid color-mix(in srgb, var(--shf) 40%, transparent)',
                  borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--shf)',
                }}>
                  {state.error}
                </div>
              )}

              <div style={{ marginTop: 4 }}>
                <SubmitBtn />
              </div>
            </form>
          )}

          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--bd)' }}>
            <Link href="/login" style={{ fontSize: 12, color: 'var(--f3)', textDecoration: 'none' }}>
              ← 로그인으로 돌아가기
            </Link>
          </div>
        </div>

        <div style={{ marginTop: 'auto', fontSize: 10, color: 'var(--f4)', display: 'flex', gap: 20, fontFamily: 'var(--mono)' }}>
          <span>v0.1 · 2026.05</span>
          <span>powered by zbra it</span>
        </div>
      </div>
    </div>
  );
}
