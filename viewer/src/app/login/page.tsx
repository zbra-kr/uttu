'use client';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { UttuMark } from '@/components/ui/icons';
import { signIn } from '../auth/actions';

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn primary" disabled={pending}
      style={{ height: 40, fontSize: 13, justifyContent: 'center' }}>
      {pending ? '로그인 중...' : '로그인'}
    </button>
  );
}

export default function LoginPage() {
  const [state, action] = useFormState(signIn, null);

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="col-flex center gap-6" style={{ alignItems: 'center', marginBottom: 4 }}>
          <UttuMark size={1.3} color="var(--hs)" />
          <span className="sec-tag">b.cave · fashion intelligence</span>
        </div>

        <hr className="hr-d" style={{ margin: '6px 0' }} />

        <form action={action} className="col-flex gap-10">
          <div>
            <span className="field-lbl">이메일</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@bcave.co.kr"
              className="input mono"
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <span className="field-lbl">비밀번호</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              placeholder="••••••••"
              style={{ width: '100%' }}
            />
          </div>

          {state?.error && (
            <div style={{
              background: 'oklch(0.96 0.01 15)',
              border: '1px solid oklch(0.6 0.15 15)',
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 12,
              color: 'oklch(0.5 0.15 15)',
            }}>
              {state.error}
            </div>
          )}

          <SubmitBtn />
        </form>

        <div className="row-flex between" style={{ marginTop: 2 }}>
          <Link href="/signup" style={{ fontSize: 11, color: 'var(--f3)', textDecoration: 'none' }}>
            계정 만들기
          </Link>
          <span style={{ fontSize: 11, color: 'var(--f4)' }}>bcave.co.kr 전용</span>
        </div>

        <hr className="hr-d" style={{ marginTop: 8, marginBottom: 6 }} />
        <div className="row-flex between">
          <span className="mono dim" style={{ fontSize: 10 }}>v0.1 · 2026.05</span>
          <span className="mono dim" style={{ fontSize: 10 }}>powered by zbra it</span>
        </div>
      </div>
    </div>
  );
}
