'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { safeAuthRedirect } from '@/lib/auth/oauth';

const DOMAIN = '@bcave.co.kr';
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const ADMIN_LOGIN_ERROR = '관리자 계정으로 로그인할 수 없습니다. 계정을 확인하거나 Microsoft 로그인을 이용해 주세요.';

export async function signIn(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  if (process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED === 'true') return signInAdmin(_prev, formData);

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: '이메일 또는 비밀번호가 올바르지 않습니다.' };

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signInAdmin(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = formData.get('email');
  const password = formData.get('password');
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return { error: ADMIN_LOGIN_ERROR };
  }

  // Never put an unapproved password session into browser cookies. The Auth
  // token hook is the direct-REST boundary; this check also fails closed if the
  // hook is unavailable or a user's current database role is not admin.
  let passwordClient: SupabaseClient | undefined;
  let cleanupClient: SupabaseClient | undefined;
  let transientSession = false;
  let committed = false;
  try {
    passwordClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    cleanupClient = passwordClient;
    const { data, error } = await passwordClient.auth.signInWithPassword({ email: email.trim(), password });
    transientSession = !!data.session;
    if (error || !data.session || !data.user) return { error: ADMIN_LOGIN_ERROR };

    const { data: verified, error: userError } = await passwordClient.auth.getUser(data.session.access_token);
    if (userError || !verified.user || verified.user.id !== data.user.id) return { error: ADMIN_LOGIN_ERROR };
    const { data: profile, error: profileError } = await passwordClient
      .from('profiles').select('role').eq('id', verified.user.id).maybeSingle();
    // Do not trust user_metadata/app_metadata or the presence of an Azure link.
    if (profileError || profile?.role !== 'admin') return { error: ADMIN_LOGIN_ERROR };

    // The installed SSR SDK can delete/store cookies even on a failed
    // setSession. Keep its cookie jar independent from the current browser.
    const stagedCookies = new Map<string, { name: string; value: string; options: CookieOptions }>();
    const storageKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]}-auth-token`;
    const buffered = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions: { name: storageKey },
        cookies: {
          getAll: () => Array.from(stagedCookies.values()).map(({ name, value }) => ({ name, value })),
          setAll: (writes: { name: string; value: string; options: CookieOptions }[]) => {
            writes.forEach(write => stagedCookies.set(write.name, write));
          },
        },
      },
    );
    const { data: browserSession, error: sessionError } = await buffered.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (browserSession.session) cleanupClient = buffered;
    if (
      sessionError || !browserSession.session || !browserSession.user
      || browserSession.user.id !== verified.user.id
      || browserSession.session.user.id !== verified.user.id
    ) return { error: ADMIN_LOGIN_ERROR };
    const { data: finalProfile, error: finalProfileError } = await buffered
      .from('profiles').select('role').eq('id', verified.user.id).maybeSingle();
    if (finalProfileError || finalProfile?.role !== 'admin') return { error: ADMIN_LOGIN_ERROR };

    const belongsToSession = (name: string) => name === storageKey
      || (name.startsWith(`${storageKey}.`) && /^\d+$/.test(name.slice(storageKey.length + 1)));
    const acceptedCookies = Array.from(stagedCookies.values()).filter(cookie => belongsToSession(cookie.name));
    const cookieOptions = acceptedCookies.find(cookie => cookie.value)?.options;
    if (!cookieOptions) return { error: ADMIN_LOGIN_ERROR };

    // Read live names only after validation, for replacing this exact namespace
    // and removing stale chunk tails. No unrelated cookies are touched.
    const store = await cookies();
    const previous = store.getAll().filter(cookie => belongsToSession(cookie.name));
    const acceptedNames = new Set(acceptedCookies.map(cookie => cookie.name));
    try {
      acceptedCookies.forEach(({ name, value, options }) => store.set(name, value, options));
      previous.filter(cookie => !acceptedNames.has(cookie.name)).forEach(({ name }) =>
        store.set(name, '', { ...cookieOptions, maxAge: 0 }),
      );
    } catch {
      // Next's cookie writes are normally synchronous. If a write fails partway,
      // restore the prior namespace before returning failure, never success.
      try {
        previous.forEach(({ name, value }) => store.set(name, value, cookieOptions));
        const previousNames = new Set(previous.map(cookie => cookie.name));
        acceptedCookies.filter(cookie => !previousNames.has(cookie.name)).forEach(({ name, options }) =>
          store.set(name, '', { ...options, maxAge: 0 }),
        );
      } catch { console.warn('[auth] Admin session cookie rollback failed'); }
      return { error: '로그인 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    }
    committed = true;
  } catch {
    return { error: ADMIN_LOGIN_ERROR };
  } finally {
    if (cleanupClient && transientSession && !committed) {
      // This client has only the newly issued grant. Never revoke other devices
      // or clear an existing browser session because a fallback attempt failed.
      try { await cleanupClient.auth.signOut({ scope: 'local' }); } catch { /* candidate-only cleanup */ }
    }
  }

  revalidatePath('/', 'layout');
  redirect(safeAuthRedirect(formData.get('next')));
}

export async function signUp(
  _prev: { error?: string; success?: string } | null,
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  if (process.env.NEXT_PUBLIC_MICROSOFT_ONLY_LOGIN_ENABLED === 'true') {
    return { error: '이메일 가입은 지원하지 않습니다. 회사 Microsoft 계정으로 로그인해 주세요.' };
  }

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const fullName = ((formData.get('full_name') as string) || '').trim();

  if (!email.toLowerCase().endsWith(DOMAIN)) {
    return { error: `${DOMAIN} 도메인만 가입할 수 있습니다.` };
  }
  if (password.length < 8) {
    return { error: '비밀번호는 최소 8자 이상이어야 합니다.' };
  }

  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${SITE_URL}/auth/callback`,
    },
  });

  if (error) {
    if (error.message.includes('P0001') || error.message.toLowerCase().includes('unauthorized domain')) {
      return { error: `${DOMAIN} 도메인만 가입할 수 있습니다.` };
    }
    if (error.message.toLowerCase().includes('already registered')) {
      return { error: '이미 가입된 이메일입니다. 로그인해 주세요.' };
    }
    return { error: error.message };
  }

  // Email Enumeration Protection ON: signUp은 신규/기존 이메일 모두 user: null 반환
  // — 이 경우 성공으로 처리 (인증 메일 발송 또는 무응답, 사용자는 구분 불가)
  if (!data.user) {
    return { success: '가입 완료! 이메일 인증 후 로그인해 주세요.' };
  }

  // Email Enumeration Protection OFF: 이미 확인된 이메일 → identities: [] 반환
  if ((data.user.identities ?? []).length === 0) {
    return { error: '이미 가입된 이메일입니다. 로그인해 주세요.' };
  }

  // 미인증 상태에서 재시도 — created_at이 30초 이상 지난 기존 계정
  if (!data.user.email_confirmed_at) {
    const ageMs = Date.now() - new Date(data.user.created_at).getTime();
    if (ageMs > 30_000) {
      return { error: '이미 인증 메일이 발송된 이메일입니다. 받은편지함을 확인해 주세요.' };
    }
  }

  return { success: '가입 완료! 이메일 인증 후 로그인해 주세요.' };
}

export async function signOut(): Promise<void> {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/login');
}

export async function resetPassword(
  _prev: { error?: string; success?: string } | null,
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const email = formData.get('email') as string;
  const sb = await supabaseServer();
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}/auth/callback?next=/reset-password`,
  });
  if (error) return { error: error.message };
  return { success: '비밀번호 재설정 링크를 이메일로 발송했습니다.' };
}

export async function updatePassword(
  _prev: { error?: string; success?: string } | null,
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const password = formData.get('password') as string;
  const confirm = formData.get('confirm') as string;

  if (password !== confirm) return { error: '비밀번호가 일치하지 않습니다.' };
  if (password.length < 8) return { error: '비밀번호는 최소 8자 이상이어야 합니다.' };

  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  redirect('/');
}
