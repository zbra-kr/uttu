import LoginView from '../login/LoginView';
import { authErrorMessage, safeAuthRedirect } from '@/lib/auth/oauth';

export default function AdminLoginPage({ searchParams = {} }: {
  searchParams?: { redirect?: string | string[]; error?: string | string[] };
}) {
  return <LoginView admin next={safeAuthRedirect(searchParams.redirect)} authError={authErrorMessage(searchParams.error)} />;
}
