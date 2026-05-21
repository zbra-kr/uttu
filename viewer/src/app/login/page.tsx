'use client';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signIn } from '../auth/actions';

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
    <div style={{ height: '100vh', display: 'flex', fontFamily: 'inherit', overflow: 'hidden' }}>

      {/* ── 좌: 브랜드 패널 ── */}
      <div style={{
        width: 420, flexShrink: 0,
        background: '#0a0e1a',
        display: 'flex', flexDirection: 'column',
        padding: '52px 48px',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.035) 0.8px, transparent 0.8px)',
        backgroundSize: '18px 18px',
        position: 'relative',
      }}>
        {/* 상단 로고 */}
        <div>
          <img
            src={LOGO}
            alt="B.CAVE"
            style={{ height: 26, opacity: 0.88 }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>

        {/* 중앙 카피 */}
        <div style={{ marginTop: 'auto', marginBottom: 'auto', paddingTop: 40, paddingBottom: 40 }}>
          <div style={{
            display: 'inline-block',
            fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
            color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
            marginBottom: 20,
          }}>
            Fashion Intelligence Platform
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', lineHeight: 1.3, letterSpacing: '-0.02em' }}>
            데이터로 움직이는<br />패션 인텔리전스
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.42)', marginTop: 18, lineHeight: 1.75 }}>
            무신사 상품·랭킹·브랜드 데이터를<br />실시간으로 수집·분석합니다
          </div>

          {/* 구분선 + 스탯 */}
          <div style={{
            display: 'flex', gap: 32, marginTop: 36,
            paddingTop: 28, borderTop: '1px solid rgba(255,255,255,0.08)',
          }}>
            {[['912', '브랜드'], ['184', '신규 리뷰'], ['142', '프로모션']].map(([n, l]) => (
              <div key={l}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '-0.02em' }}>{n}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2, letterSpacing: '0.04em' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 하단 법적 고지 */}
        <div style={{
          fontSize: 9.5, color: 'rgba(255,255,255,0.2)', lineHeight: 1.7,
          borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20,
        }}>
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

          {/* 헤더 */}
          <div style={{ marginBottom: 36 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--f1)', letterSpacing: '-0.02em' }}>
              로그인
            </div>
            <div style={{ fontSize: 13, color: 'var(--f4)', marginTop: 6 }}>
              B.CAVE 계정으로 접속하세요
            </div>
          </div>

          {/* 폼 */}
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--f2)' }}>비밀번호</label>
                <Link href="/forgot-password" style={{ fontSize: 11, color: 'var(--hs)', textDecoration: 'none' }}>
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
                style={{ width: '100%', height: 42, borderRadius: 8 }}
              />
            </div>

            {state?.error && (
              <div style={{
                background: 'var(--shb)', border: '1px solid color-mix(in srgb, var(--shf) 40%, transparent)',
                borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--shf)',
              }}>
                {state.error}
              </div>
            )}

            <div style={{ marginTop: 4 }}>
              <SubmitBtn />
            </div>
          </form>

          {/* 하단 링크 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--bd)',
          }}>
            <Link href="/signup" style={{ fontSize: 12, color: 'var(--f3)', textDecoration: 'none' }}>
              계정 만들기
            </Link>
            <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>bcave.co.kr 전용</span>
          </div>
        </div>

        {/* 버전 */}
        <div style={{ marginTop: 'auto', fontSize: 10, color: 'var(--f4)', display: 'flex', gap: 20, fontFamily: 'var(--mono)' }}>
          <span>v0.1 · 2026.05</span>
          <span>powered by zbra it</span>
        </div>
      </div>
    </div>
  );
}
