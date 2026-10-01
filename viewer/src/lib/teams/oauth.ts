import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { TEAMS_OAUTH_SCOPES, type TeamsConfig } from './config';
import { microsoftIdentity, sameMicrosoftIdentity, type MicrosoftIdentity } from './identity';
import { decryptTeamsValue, encryptTeamsValue } from './vault';
import { TEAMS_DELEGATED_SCOPES, type AuthorGrant } from './graph';
import { safeTeamsSetupNext } from './setup-navigation';

interface Connection {
  user_id: string;
  tenant_id: string;
  object_id: string;
  token_ciphertext: string;
  version: string;
  consent_epoch: string;
}

interface TokenBundle extends AuthorGrant {
  refreshToken: string;
  consentEpoch: string;
}

interface OAuthAttempt {
  identity: MicrosoftIdentity;
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
  previousVersion: string | null;
  connectionEpoch: string;
  returnTo?: string;
}

export const connectCookie = (secure: boolean) => secure ? '__Host-uttu-teams-connect' : 'uttu-teams-connect';
const tokenContext = (id: MicrosoftIdentity, epoch: string) => `tokens:${id.userId}:${id.tenantId}:${id.objectId}:${epoch}`;
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function exactEqual(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function getTeamsConnection(sb: SupabaseClient, userId: string): Promise<Connection | null> {
  const { data, error } = await sb.rpc('uttu_teams_get_connection', { p_author_id: userId });
  if (error) throw new Error('Teams connection unavailable');
  return Array.isArray(data) && data.length === 1 ? data[0] as Connection : null;
}

export async function beginTeamsConnect(sb: SupabaseClient, user: User, config: TeamsConfig, returnTo?: unknown) {
  const identity = microsoftIdentity(user, config.tenantId);
  if (!identity) throw new Error('Microsoft identity required');
  const previous = await getTeamsConnection(sb, user.id);
  const { data: epoch, error: epochError } = await sb.rpc('uttu_teams_get_connection_epoch', { p_author_id: user.id });
  if (epochError || typeof epoch !== 'string') throw new Error('Teams connection unavailable');
  const attempt: OAuthAttempt = {
    identity, state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 10 * 60_000,
    previousVersion: previous?.version ?? null,
    connectionEpoch: epoch,
    returnTo: returnTo === undefined ? '/me' : safeTeamsSetupNext(returnTo),
  };
  const url = new URL(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId, response_type: 'code', redirect_uri: config.callback,
    response_mode: 'query', scope: TEAMS_OAUTH_SCOPES, state: attempt.state, nonce: attempt.nonce,
    code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString(), cookie: encryptTeamsValue(attempt, config.encryptionKey, 'oauth-attempt') };
}

/** A failed provider round trip may retain only a verified, encrypted app path. */
export function teamsConnectReturnPath(user: User, config: TeamsConfig, cookie: string, state: string): string {
  try {
    const identity = microsoftIdentity(user, config.tenantId);
    const attempt = decryptTeamsValue(cookie, config.encryptionKey, 'oauth-attempt') as OAuthAttempt;
    if (!identity || !attempt?.identity || !sameMicrosoftIdentity(attempt.identity, identity)
      || !exactEqual(attempt.state, state) || !Number.isFinite(attempt.expiresAt)
      || attempt.expiresAt < Date.now()) return '/me';
    return safeTeamsSetupNext(attempt.returnTo ?? '/me');
  } catch { return '/me'; }
}

type TokenResponse = Record<string, unknown>;

async function exchangeToken(config: TeamsConfig, parameters: Record<string, string>): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
        scope: TEAMS_OAUTH_SCOPES, ...parameters }),
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error();
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as TokenResponse;
  } catch { throw new Error('Teams reconnect required'); }
}

function tokenBundle(data: TokenResponse, identity: MicrosoftIdentity, consentEpoch: string, previousRefresh?: string): TokenBundle {
  const scopes = typeof data.scope === 'string'
    ? data.scope.split(/\s+/).map(scope => scope.replace(/^https:\/\/graph\.microsoft\.com\//, '')) : [];
  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : previousRefresh;
  if (data.token_type !== 'Bearer' || typeof data.access_token !== 'string' || !data.access_token
    || /[\r\n]/.test(data.access_token) || !refreshToken
    || typeof data.expires_in !== 'number' || data.expires_in <= 60 || data.expires_in > 172_800
    || !TEAMS_DELEGATED_SCOPES.every(scope => scopes.includes(scope))) {
    throw new Error('Teams reconnect required');
  }
  return { identity, accessToken: data.access_token, refreshToken, scopes, consentEpoch,
    expiresAt: Date.now() + data.expires_in * 1000, consented: true };
}

async function saveBundle(sb: SupabaseClient, config: TeamsConfig, bundle: TokenBundle, version: string | null, epoch: string | null = null) {
  const { data, error } = await sb.rpc('uttu_teams_put_connection', {
    p_author_id: bundle.identity.userId,
    p_token_ciphertext: encryptTeamsValue(bundle, config.encryptionKey, tokenContext(bundle.identity, bundle.consentEpoch)),
    p_granted_scopes: bundle.scopes,
    p_expires_at: new Date(bundle.expiresAt).toISOString(),
    p_expected_version: version,
    p_expected_epoch: epoch,
  });
  if (error) throw new Error('Teams connection unavailable');
  return typeof data === 'string' ? data : null;
}

export async function completeTeamsConnect(
  sb: SupabaseClient, user: User, config: TeamsConfig, encryptedAttempt: string,
  state: string, code: string,
): Promise<string> {
  const identity = microsoftIdentity(user, config.tenantId);
  const attempt = decryptTeamsValue(encryptedAttempt, config.encryptionKey, 'oauth-attempt') as OAuthAttempt;
  if (!identity || !attempt?.identity || !sameMicrosoftIdentity(identity, attempt.identity)
    || !Number.isFinite(attempt.expiresAt) || attempt.expiresAt <= Date.now()
    || !exactEqual(attempt.state, state) || typeof attempt.verifier !== 'string'
    || typeof attempt.nonce !== 'string' || !code || code.length > 20_000) {
    throw new Error('Teams connect rejected');
  }
  const data = await exchangeToken(config, { grant_type: 'authorization_code', code,
    code_verifier: attempt.verifier, redirect_uri: config.callback });
  if (typeof data.id_token !== 'string') throw new Error('Teams connect rejected');
  const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
  let keys = keySets.get(config.tenantId);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`),
      { timeoutDuration: 10_000 });
    keySets.set(config.tenantId, keys);
  }
  const { payload } = await jwtVerify(data.id_token, keys, {
    issuer, audience: config.clientId, algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'nonce', 'oid', 'tid', 'sub'], maxTokenAge: '10m', clockTolerance: 5,
  });
  if (!exactEqual(payload.nonce, attempt.nonce) || payload.oid !== identity.objectId
    || payload.tid !== identity.tenantId) throw new Error('Teams account mismatch');
  const bundle = tokenBundle(data, identity, attempt.connectionEpoch);
  if (!await saveBundle(sb, config, bundle, attempt.previousVersion, attempt.connectionEpoch)) {
    throw new Error('Teams connection changed');
  }
  return safeTeamsSetupNext(attempt.returnTo ?? '/me');
}

function readBundle(connection: Connection, config: TeamsConfig, identity: MicrosoftIdentity): TokenBundle {
  if (connection.tenant_id !== identity.tenantId || connection.object_id !== identity.objectId
    || connection.user_id !== identity.userId) throw new Error('Teams reconnect required');
  const bundle = decryptTeamsValue(connection.token_ciphertext, config.encryptionKey, tokenContext(identity, connection.consent_epoch)) as TokenBundle;
  if (!bundle?.identity || !sameMicrosoftIdentity(bundle.identity, identity) || !bundle.consented
    || bundle.consentEpoch !== connection.consent_epoch
    || typeof bundle.accessToken !== 'string' || typeof bundle.refreshToken !== 'string'
    || !bundle.accessToken || !bundle.refreshToken || !Array.isArray(bundle.scopes)
    || !TEAMS_DELEGATED_SCOPES.every(scope => bundle.scopes.includes(scope))
    || !Number.isFinite(bundle.expiresAt)) throw new Error('Teams reconnect required');
  return bundle;
}

/** Called only by an authenticated author's explicit new-mention submission. */
export async function getTeamsAuthorGrant(sb: SupabaseClient, user: User, config: TeamsConfig): Promise<AuthorGrant | null> {
  const identity = microsoftIdentity(user, config.tenantId);
  if (!identity) return null;
  const connection = await getTeamsConnection(sb, user.id);
  if (!connection) return null;
  let bundle = readBundle(connection, config, identity);
  if (bundle.expiresAt > Date.now() + 90_000) return { ...bundle, connectionVersion: connection.version };
  const response = await exchangeToken(config, { grant_type: 'refresh_token', refresh_token: bundle.refreshToken });
  bundle = tokenBundle(response, identity, bundle.consentEpoch, bundle.refreshToken);
  const savedVersion = await saveBundle(sb, config, bundle, connection.version);
  if (savedVersion) return { ...bundle, connectionVersion: savedVersion };
  // A concurrent refresh/disconnect won. Never resurrect a deleted connection.
  const latest = await getTeamsConnection(sb, user.id);
  if (!latest) return null;
  const winner = readBundle(latest, config, identity);
  return winner.expiresAt > Date.now() + 30_000 ? { ...winner, connectionVersion: latest.version } : null;
}
