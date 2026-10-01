import type { SupabaseClient, User } from '@supabase/supabase-js';

// Keep imported names usable as a single @mention token. ECMAScript \s covers
// Unicode whitespace (and BOM), except NEXT LINE (U+0085). Do not alter letters,
// punctuation, or zero-width joiners that can be meaningful parts of a name.
function withoutNameWhitespace(value: string): string {
  return value.replace(/[\s\u0085]+/g, '');
}

/** Display text only. Never use a name or user metadata to decide access. */
export function microsoftDisplayName(user: User | null | undefined): string | undefined {
  for (const identity of user?.identities ?? []) {
    if (identity.provider !== 'azure') continue;
    for (const value of [identity.identity_data?.full_name, identity.identity_data?.name]) {
      if (typeof value !== 'string') continue;
      const name = withoutNameWhitespace(value);
      if (name) return name;
    }
  }
  return undefined;
}

type NameSyncResult = 'skipped' | 'updated' | 'failed';

async function syncAppProfileName(
  supabase: SupabaseClient,
  userId: string,
  fullName: string,
): Promise<NameSyncResult> {
  try {
    const { data: profile, error } = await supabase
      .from('profiles').select('full_name').eq('id', userId).maybeSingle();
    if (error) return 'failed';
    if (!profile) return 'skipped';
    const previousName: unknown = profile.full_name;
    if (previousName !== null && typeof previousName !== 'string') return 'skipped';
    const previousNormalizedName = previousName === null ? '' : withoutNameWhitespace(previousName);
    // New signups may already have the unnormalized name from the DB trigger.
    // Preserve distinct custom names and aliases; never guess names from email.
    if (previousName === fullName || (previousNormalizedName && previousNormalizedName !== fullName)) {
      return 'skipped';
    }

    let update = supabase.from('profiles').update({ full_name: fullName }).eq('id', userId);
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

async function syncAuthMetadataNames(
  supabase: SupabaseClient,
  user: User,
  fullName: string,
): Promise<NameSyncResult> {
  const data: Record<string, string> = {};
  // OAuth can refresh these display fields on every login. Only normalize
  // existing values that match the Azure claim; preserve other metadata and
  // custom names. Never write provider identities, app_metadata or credentials.
  for (const key of ['full_name', 'name']) {
    const previousName: unknown = user.user_metadata?.[key];
    if (typeof previousName === 'string' && previousName !== fullName
      && withoutNameWhitespace(previousName) === fullName) {
      data[key] = fullName;
    }
  }
  if (!Object.keys(data).length) return 'skipped';
  try {
    const { error } = await supabase.auth.updateUser({ data });
    return error ? 'failed' : 'updated';
  } catch {
    return 'failed';
  }
}

/** Normalize Azure-imported display names after a successful OAuth exchange. */
export async function syncMicrosoftProfileName(
  supabase: SupabaseClient,
  user: User | null | undefined,
): Promise<NameSyncResult> {
  const fullName = microsoftDisplayName(user);
  if (!user || !fullName) return 'skipped';

  // Each write is best-effort so one failure cannot prevent the other or login.
  const results = await Promise.all([
    syncAppProfileName(supabase, user.id, fullName),
    syncAuthMetadataNames(supabase, user, fullName),
  ]);
  if (results.includes('failed')) return 'failed';
  return results.includes('updated') ? 'updated' : 'skipped';
}
