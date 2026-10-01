import type { User } from '@supabase/supabase-js';

export interface MicrosoftIdentity {
  userId: string;
  tenantId: string;
  objectId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Input MUST come from server-side auth.getUser() or the Auth identity table.
 * Never accept a browser-supplied User, raw user_metadata, a display name, email,
 * provider_id/sub (pairwise subject), or an unverified decoded Graph access token.
 * Supabase's Azure parser preserves oid/tid inside identity_data.custom_claims.
 */
export function microsoftIdentity(
  user: Pick<User, 'id' | 'identities'> | null | undefined,
  expectedTenant: string,
): MicrosoftIdentity | null {
  if (!user || !isUuid(user.id) || !isUuid(expectedTenant)) return null;
  const identities = user.identities?.filter(identity => identity.provider === 'azure') ?? [];
  // Ambiguous accounts must be repaired explicitly; never select the first one.
  if (identities.length !== 1) return null;
  const data = identities[0].identity_data;
  const claims: unknown = data?.custom_claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
  const { oid, tid } = claims as Record<string, unknown>;
  if (!isUuid(oid) || !isUuid(tid)) return null;
  const tenantId = tid.toLowerCase();
  if (tenantId !== expectedTenant.toLowerCase()) return null;
  if (data?.iss !== `https://login.microsoftonline.com/${tenantId}/v2.0`) return null;
  return { userId: user.id.toLowerCase(), tenantId, objectId: oid.toLowerCase() };
}

export function sameMicrosoftIdentity(a: MicrosoftIdentity, b: MicrosoftIdentity): boolean {
  return a.userId === b.userId && a.tenantId === b.tenantId && a.objectId === b.objectId;
}
