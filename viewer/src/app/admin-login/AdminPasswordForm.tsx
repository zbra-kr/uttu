'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { signIn, signInAdmin } from '../auth/actions';

function SubmitButton({ mobile, admin }: { mobile: boolean; admin: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" disabled={pending} aria-busy={pending}
      style={{
        height: mobile ? 44 : 40, width: '100%', fontSize: mobile ? 14 : 13, fontWeight: 600,
        background: 'var(--hs)', color: mobile ? 'var(--rai)' : 'var(--white)', border: 'none',
        borderRadius: mobile ? 10 : 7, cursor: pending ? 'not-allowed' : 'pointer',
        opacity: pending ? 0.65 : 1, transition: 'opacity 150ms',
      }}
    >
      {pending ? '로그인 중…' : admin ? '관리자 로그인' : '로그인'}
    </button>
  );
}

export default function AdminPasswordForm({ next, mobile = false, admin = true }: { next: string; mobile?: boolean; admin?: boolean }) {
  const [state, action] = useFormState(admin ? signInAdmin : signIn, null);
  const inputStyle = {
    height: mobile ? 42 : 38, padding: '0 12px', borderRadius: 7, fontSize: mobile ? 13 : 12,
    border: '1px solid var(--bd)', background: 'var(--snk)',
    color: 'var(--f1)', outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  };
  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: mobile ? (admin || process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED !== 'true' ? 0 : 20) : admin ? 28 : 32 }}>
      <input type="hidden" name="next" value={next} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label htmlFor="admin-email" style={{ fontSize: mobile ? 12 : 11, fontWeight: 500, color: 'var(--f3)' }}>이메일</label>
        <input id="admin-email" name="email" type="email" required autoFocus autoComplete="username" placeholder={admin ? '관리자 이메일' : 'name@bcave.co.kr'} style={inputStyle} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label htmlFor="admin-password" style={{ fontSize: mobile ? 12 : 11, fontWeight: 500, color: 'var(--f3)' }}>비밀번호</label>
        <input id="admin-password" name="password" type="password" required autoComplete="current-password" placeholder="••••••••" style={inputStyle} />
      </div>
      {state?.error && (
        <div role="alert" style={{ background: 'var(--shb)', border: '1px solid var(--shf)', borderRadius: 7, padding: '10px 12px', fontSize: 12, color: 'var(--shf)' }}>
          {state.error}
        </div>
      )}
      <div style={{ marginTop: 4 }}><SubmitButton mobile={mobile} admin={admin} /></div>
    </form>
  );
}
