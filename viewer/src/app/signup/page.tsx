import { redirect } from 'next/navigation';
import { safeAuthRedirect } from '@/lib/auth/oauth';
import SignupView from './SignupView';

export default function SignupPage({ searchParams = {} }: {
  searchParams?: { redirect?: string | string[] };
}) {
  if (process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED !== 'true') return <SignupView />;
  const next = safeAuthRedirect(searchParams.redirect);
  redirect(next === '/' ? '/login' : `/login?redirect=${encodeURIComponent(next)}`);
}
