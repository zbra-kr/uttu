'use client';
import React from 'react';
import Link from 'next/link';
import AdminPasswordForm from '../admin-login/AdminPasswordForm';
import MicrosoftLogin from './MicrosoftLogin';

const WORDMARK_LIGHT = '/images/uttu/svg/uttu-wordmark.svg';
const WORDMARK_DARK  = '/images/uttu/svg/uttu-wordmark-white.svg';

export default function MobileLoginView({ next, authError, admin = false }: { next: string; authError?: string; admin?: boolean }) {
  const microsoftOnly = process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED === 'true';
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
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--f1)', letterSpacing: '-0.02em' }}>{admin ? '관리자 로그인' : '로그인'}</div>
            <div style={{ fontSize: 12, color: 'var(--f4)', marginTop: 4 }}>{admin ? '기존 관리자 계정만 이메일·비밀번호로 접속할 수 있습니다' : microsoftOnly ? '회사 Microsoft 계정으로 접속하세요' : 'B.CAVE 메일계정으로 접속하세요'}</div>
          </div>

          {authError && (
            <div role="alert" style={{ marginBottom: 16, fontSize: 12, lineHeight: 1.6, color: 'var(--shf)' }}>
              {authError}
            </div>
          )}
          {admin ? <AdminPasswordForm next={next} mobile /> : (
            <>
              <MicrosoftLogin next={next} />
              {microsoftOnly ? (
                <p style={{ fontSize: 12, color: 'var(--f4)', lineHeight: 1.7, marginTop: 20 }}>
                  {process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED === 'true'
                    ? '처음 이용하는 분도 Microsoft 로그인으로 시작하세요.'
                    : 'Microsoft 로그인을 준비 중입니다. IT팀에 문의해 주세요.'}
                </p>
              ) : <AdminPasswordForm next={next} admin={false} mobile /> }
            </>
          )}

          <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--bd)', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 16 }}>
            {!admin && !microsoftOnly && (
              <>
                <Link href="/signup" style={{ fontSize: 12, fontWeight: 500, color: 'var(--hs)', textDecoration: 'none' }}>계정 만들기</Link>
                <span style={{ color: 'var(--bd)', fontSize: 14 }}>·</span>
                <Link href="/forgot-password" style={{ fontSize: 12, fontWeight: 500, color: 'var(--hs)', textDecoration: 'none' }}>비밀번호 찾기</Link>
                <span style={{ color: 'var(--bd)', fontSize: 14 }}>·</span>
              </>
            )}
            <Link href={admin ? (next === '/' ? '/login' : `/login?redirect=${encodeURIComponent(next)}`) : (next === '/' ? '/admin-login' : `/admin-login?redirect=${encodeURIComponent(next)}`)} style={{ fontSize: 13, fontWeight: 500, color: 'var(--hs)', textDecoration: 'none' }}>
              {admin ? 'Microsoft 로그인' : '관리자 로그인'}
            </Link>
            {admin && (
              <>
                <span style={{ color: 'var(--bd)', fontSize: 14 }}>·</span>
                <Link href="/forgot-password" style={{ fontSize: 13, fontWeight: 500, color: 'var(--hs)', textDecoration: 'none' }}>
                  비밀번호 찾기
                </Link>
              </>
            )}
          </div>
        </div>

        <p style={{ fontSize: 11, color: 'var(--f4)', textAlign: 'center', marginTop: 20, lineHeight: 1.7 }}>
          ⓒ 2026 B.CAVE Corp. All rights reserved.
        </p>
      </div>
    </div>
  );
}
