import type { SupabaseClient, User } from '@supabase/supabase-js';

/** Display text only. Never use a name or user metadata to decide access. */
export function microsoftDisplayName(user: User | null | undefined): string | undefined {
  for (const identity of user?.identities ?? []) {
    if (identity.provider !== 'azure') continue;
    for (const value of [identity.identity_data?.full_name, identity.identity_data?.name]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return undefined;
}

/** Fill a missing app name after Auth refreshes the Azure identity on login. */
export async function syncMicrosoftProfileName(
  supabase: SupabaseClient,
  user: User | null | undefined,
): Promise<'skipped' | 'updated' | 'failed'> {
  const fullName = microsoftDisplayName(user);
  if (!user || !fullName) return 'skipped';

  try {
    const { data: profile, error } = await supabase
      .from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    if (error) return 'failed';
    if (!profile) return 'skipped';
    const previousName: unknown = profile.full_name;
    if (previousName !== null && (typeof previousName !== 'string' || previousName.trim())) {
      return 'skipped';
    }

    let update = supabase.from('profiles').update({ full_name: fullName }).eq('id', user.id);
    // Preserve a custom name saved concurrently between the read and write.
    update = previousName === null
      ? update.is('full_name', null)
      : update.eq('full_name', previousName);
    const { error: updateError } = await update;
    return updateError ? 'failed' : 'updated';
  } catch {
    // A profile write must not turn a valid login into an authentication error.
    return 'failed';
  }
}
