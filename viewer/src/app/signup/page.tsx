import { redirect } from 'next/navigation';
import { safeAuthRedirect } from '@/lib/auth/oauth';
import SignupView from './SignupView';

export default async function SignupPage({ searchParams }: {
  searchParams?: Promise<{ redirect?: string | string[] }>;
}) {
  if (process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED !== 'true') return <SignupView />;
  const query = await searchParams ?? {};
  const next = safeAuthRedirect(query.redirect);
  redirect(next === '/' ? '/login' : `/login?redirect=${encodeURIComponent(next)}`);
}
