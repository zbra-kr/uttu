'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { signInWithMicrosoft } from '../auth/microsoft';

function MicrosoftSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      style={{
        minHeight: 44, width: '100%', borderRadius: 7,
        border: '1px solid var(--bd)', background: 'var(--sur)', color: 'var(--f1)',
        fontSize: 13, fontWeight: 600, cursor: pending ? 'not-allowed' : 'pointer',
        opacity: pending ? 0.65 : 1,
      }}
    >
      {pending ? 'Microsoft로 이동 중…' : '회사 Microsoft 계정으로 로그인'}
    </button>
  );
}

export default function MicrosoftLogin({ next }: { next: string }) {
  const [state, action] = useFormState(signInWithMicrosoft, null);
  if (process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED !== 'true') return null;
  return (
    <form action={action} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input type="hidden" name="next" value={next} />
      <MicrosoftSubmitButton />
      {state?.error && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--shf)', lineHeight: 1.6 }}>
          {state.error}
        </div>
      )}
    </form>
  );
}
