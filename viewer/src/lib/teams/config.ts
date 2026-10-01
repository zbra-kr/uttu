import 'server-only';
import { isUuid } from './identity';

export const COMPANY_TENANT = '09cefcf6-a744-4cc2-a8ec-681fe0d1a85a';
export const MICROSOFT_CLIENT = '9606242c-c22e-453b-a65a-bcb33b59b5d3';
export const TEAMS_CALLBACK = '/auth/teams/callback';
export const TEAMS_OAUTH_SCOPES = 'openid email profile offline_access https://graph.microsoft.com/Chat.Create https://graph.microsoft.com/ChatMessage.Send';

export interface TeamsConfig {
  origin: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
  callback: string;
  secure: boolean;
}

export function teamsConfig(): TeamsConfig | null {
  if (process.env.TEAMS_MENTIONS_ENABLED !== 'true') return null;
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '');
    const secure = origin.protocol === 'https:';
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
      || (!secure && !(process.env.NODE_ENV !== 'production' && origin.hostname === 'localhost'
        && origin.protocol === 'http:'))) return null;
    const tenantId = process.env.TEAMS_MICROSOFT_TENANT_ID || COMPANY_TENANT;
    const clientId = process.env.TEAMS_MICROSOFT_CLIENT_ID || MICROSOFT_CLIENT;
    const clientSecret = process.env.TEAMS_MICROSOFT_CLIENT_SECRET;
    const encryptionKey = process.env.TEAMS_TOKEN_ENCRYPTION_KEY;
    if (tenantId !== COMPANY_TENANT || clientId !== MICROSOFT_CLIENT
      || !isUuid(tenantId) || !isUuid(clientId) || !clientSecret || !encryptionKey
      || !/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey)
      || Buffer.from(encryptionKey, 'base64').length !== 32) return null;
    return { origin: origin.origin, tenantId, clientId, clientSecret, encryptionKey,
      callback: new URL(TEAMS_CALLBACK, origin).toString(), secure };
  } catch { return null; }
}

export function isSameOriginPost(request: Request, origin: string): boolean {
  return request.headers.get('origin') === origin
    && ['same-origin', null].includes(request.headers.get('sec-fetch-site'))
    && request.headers.get('content-type')?.split(';')[0].trim() === 'application/json';
}
