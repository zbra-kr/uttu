import type { SupabaseClient, User } from '@supabase/supabase-js';
import { isUuid, microsoftIdentity, sameMicrosoftIdentity, type MicrosoftIdentity } from './identity';
import { evaluateTeamsAccess, type TeamsAccessDecision } from './setup-policy';

// Keep the middleware dependency graph free of node:crypto and provider tokens.
// These are the same pinned identifiers as config.ts; regression tests compare them.
export const SETUP_TENANT = '09cefcf6-a744-4cc2-a8ec-681fe0d1a85a';
export const SETUP_CLIENT = '9606242c-c22e-453b-a65a-bcb33b59b5d3';

interface SetupConnection {
  user_id?: unknown;
  tenant_id?: unknown;
  object_id?: unknown;
  consent_epoch?: unknown;
  token_ciphertext?: unknown;
}

function base64Bytes(value: string, url = false): Uint8Array<ArrayBuffer> {
  const normalized = url ? value.replace(/-/g, '+').replace(/_/g, '/') : value;
  const decoded = atob(normalized);
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
  const canonical = btoa(decoded);
  // Ciphertext text is fingerprinted, so require its one canonical encoding.
  // Existing key configuration is defined by the decoded32 bytes, matching
  // config.ts/Node's decoder; equivalent key encodings must keep working.
  if (url && canonical.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') !== value) {
    throw new Error('Invalid encoding');
  }
  return bytes;
}

export function teamsSetupRequired(): boolean {
  return process.env.TEAMS_CONNECTION_REQUIRED === 'true';
}

export function teamsSetupConfigurationAvailable(): boolean {
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '');
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
      || (origin.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production'
        && origin.protocol === 'http:' && origin.hostname === 'localhost'))) return false;
    const key = process.env.TEAMS_TOKEN_ENCRYPTION_KEY || '';
    return process.env.TEAMS_MENTIONS_ENABLED === 'true'
      && (process.env.TEAMS_MICROSOFT_TENANT_ID || SETUP_TENANT) === SETUP_TENANT
      && (process.env.TEAMS_MICROSOFT_CLIENT_ID || SETUP_CLIENT) === SETUP_CLIENT
      && !!process.env.TEAMS_MICROSOFT_CLIENT_SECRET
      && /^[A-Za-z0-9+/]{43}=$/.test(key) && base64Bytes(key).length === 32;
  } catch { return false; }
}

/** Verify provenance of the saved grant without returning any decrypted material.
 * Own-user database RPCs can accept ciphertext, so their metadata alone cannot
 * attest that Microsoft OAuth actually completed. AES-GCM authentication does.
 * Access-token expiry deliberately does not force consent: refresh is normal.
 */
export async function verifyTeamsSetupConnection(
  value: unknown, identity: MicrosoftIdentity, key: string,
): Promise<boolean> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as SetupConnection;
    if (row.user_id !== identity.userId || row.tenant_id !== identity.tenantId
      || row.object_id !== identity.objectId || typeof row.consent_epoch !== 'string'
      || !row.consent_epoch || typeof row.token_ciphertext !== 'string'
      || row.token_ciphertext.length > 100_000 || !/^[A-Za-z0-9+/]{43}=$/.test(key)) return false;
    const parts = row.token_ciphertext.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1'
      || parts.slice(1).some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    const iv = base64Bytes(parts[1], true), tag = base64Bytes(parts[2], true);
    const encrypted = base64Bytes(parts[3], true);
    if (iv.length !== 12 || tag.length !== 16) return false;
    const ciphertext = new Uint8Array(encrypted.length + tag.length);
    ciphertext.set(encrypted); ciphertext.set(tag, encrypted.length);
    const aesKey = await crypto.subtle.importKey('raw', base64Bytes(key), 'AES-GCM', false, ['decrypt']);
    const context = `uttu:teams:v1:tokens:${identity.userId}:${identity.tenantId}:${identity.objectId}:${row.consent_epoch}`;
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(context), tagLength: 128 }, aesKey, ciphertext);
    const bundle = JSON.parse(new TextDecoder().decode(plaintext));
    return !!bundle && typeof bundle === 'object' && !Array.isArray(bundle)
      && !!bundle.identity && sameMicrosoftIdentity(bundle.identity, identity)
      && bundle.consented === true && bundle.consentEpoch === row.consent_epoch
      && typeof bundle.accessToken === 'string' && !!bundle.accessToken
      && typeof bundle.refreshToken === 'string' && !!bundle.refreshToken
      && Array.isArray(bundle.scopes)
      && ['Chat.Create', 'ChatMessage.Send'].every(scope => bundle.scopes.includes(scope))
      && typeof bundle.expiresAt === 'number' && Number.isFinite(bundle.expiresAt);
  } catch { return false; }
}

export interface TeamsSetupAccess {
  decision: TeamsAccessDecision;
  canConnect: boolean;
}

export async function readTeamsSetupAccess(sb: SupabaseClient, user: User): Promise<TeamsSetupAccess> {
  const required = teamsSetupRequired();
  if (!required) return { decision: { allowed: true, reason: 'disabled' }, canConnect: false };
  // An existing protected DB role keeps emergency admin access independent of
  // the new Teams RPC/configuration. Never use user_metadata as a role source.
  const profile = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!profile.error && profile.data?.role === 'admin') {
    return { decision: { allowed: true, reason: 'admin_exempt' }, canConnect: false };
  }
  if (profile.error || !profile.data || !teamsSetupConfigurationAvailable()) {
    return { decision: { allowed: false, reason: 'unavailable' }, canConnect: false };
  }
  const identity = microsoftIdentity(user, SETUP_TENANT);
  if (!identity) return { decision: { allowed: false, reason: 'identity_required' }, canConnect: false };
  const { data, error } = await sb.rpc('uttu_teams_setup_status', { p_actor_id: user.id });
  let connectionVerified = false;
  if (!error && data?.status === 'connected' && isUuid(data.connection_version)) {
    const current = await sb.rpc('uttu_teams_get_connection', { p_author_id: user.id });
    if (!current.error && Array.isArray(current.data) && current.data.length === 1
      && current.data[0]?.version === data.connection_version) {
      connectionVerified = await verifyTeamsSetupConnection(current.data[0], identity,
        process.env.TEAMS_TOKEN_ENCRYPTION_KEY || '');
    }
  }
  const decision = evaluateTeamsAccess({ enabled: true, verifiedRole: profile.data.role,
    rpcData: data, rpcError: error, connectionVerified });
  return { decision, canConnect: !error && decision.reason !== 'unavailable' };
}
