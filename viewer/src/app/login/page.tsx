import LoginView from './LoginView';
import { authErrorMessage, safeAuthRedirect } from '@/lib/auth/oauth';

export default function LoginPage({ searchParams = {} }: {
  searchParams?: { redirect?: string | string[]; error?: string | string[] };
}) {
  return <LoginView next={safeAuthRedirect(searchParams.redirect)} authError={authErrorMessage(searchParams.error)} />;
}
