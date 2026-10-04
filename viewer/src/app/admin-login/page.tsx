import LoginView from '../login/LoginView';
import { authErrorMessage, safeAuthRedirect } from '@/lib/auth/oauth';

export default async function AdminLoginPage({ searchParams }: {
  searchParams?: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}) {
  const query = await searchParams ?? {};
  return <LoginView admin next={safeAuthRedirect(query.redirect)} authError={authErrorMessage(query.error)} />;
}
