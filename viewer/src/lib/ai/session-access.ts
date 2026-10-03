import type { SupabaseClient } from '@supabase/supabase-js';

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

type SessionAccess =
  | { ok: true; created: boolean }
  | { ok: false; status: 403 | 503; error: 'session_forbidden' | 'service_unavailable' };

/** Service-role callers must establish ownership before any history write or inference.
 * An insert (not an upsert) cannot take over an existing UUID. A simultaneous
 * creation is resolved by the PK constraint and a fresh owner check.
 */
export async function ensureOwnedAiSession(
  sb: SupabaseClient,
  session: { id: string; user_id: string; route: string; context: string[] },
): Promise<SessionAccess> {
  const unavailable = { ok: false, status: 503, error: 'service_unavailable' } as const;
  const forbidden = { ok: false, status: 403, error: 'session_forbidden' } as const;
  try {
    const readOwner = () => sb.from('ai_sessions').select('user_id').eq('id', session.id).maybeSingle();
    const { data, error } = await readOwner();
    if (error) return unavailable;
    if (data) return data.user_id === session.user_id ? { ok: true, created: false } : forbidden;

    const { error: insertError } = await sb.from('ai_sessions').insert(session);
    if (!insertError) return { ok: true, created: true };
    if (insertError.code !== '23505') return unavailable;

    const { data: winner, error: readError } = await readOwner();
    if (readError || !winner) return unavailable;
    return winner.user_id === session.user_id ? { ok: true, created: false } : forbidden;
  } catch {
    return unavailable;
  }
}
