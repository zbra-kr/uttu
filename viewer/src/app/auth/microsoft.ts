'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { microsoftOAuthCredentials } from '@/lib/auth/oauth';

export async function signInWithMicrosoft(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  // Keep the endpoint gated as well as the button. Enable only after the rollout
  // checklist, tenant restriction and email verification in docs/MICROSOFT_SSO.md.
  if (process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED !== 'true') {
    return { error: 'Microsoft 로그인이 아직 설정되지 않았습니다.' };
  }

  const production = process.env.NODE_ENV === 'production';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || (!production ? 'http://localhost:3100' : '');
  let credentials;
  try {
    credentials = microsoftOAuthCredentials(appUrl, formData.get('next'), production);
  } catch {
    return { error: '로그인 주소가 설정되지 않았습니다. IT팀에 문의해 주세요.' };
  }

  let url: string | null;
  try {
    const sb = await supabaseServer();
    const { data, error } = await sb.auth.signInWithOAuth(credentials);
    if (error || !data.url) {
      return { error: 'Microsoft 로그인에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    }
    url = data.url;
  } catch {
    return { error: 'Microsoft 로그인에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  // Next.js redirect throws internally; do not catch it as an OAuth failure.
  redirect(url);
}
