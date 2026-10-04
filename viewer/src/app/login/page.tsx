import LoginView from './LoginView';
import { authErrorMessage, safeAuthRedirect } from '@/lib/auth/oauth';

export default async function LoginPage({ searchParams }: {
  searchParams?: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}) {
  const query = await searchParams ?? {};
  return <LoginView next={safeAuthRedirect(query.redirect)} authError={authErrorMessage(query.error)} />;
}
