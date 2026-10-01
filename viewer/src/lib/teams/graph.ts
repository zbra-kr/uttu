import 'server-only';

import { isUuid, sameMicrosoftIdentity, type MicrosoftIdentity } from './identity';

export const TEAMS_DELEGATED_SCOPES = ['Chat.Create', 'ChatMessage.Send'] as const;
const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface AuthorGrant {
  identity: MicrosoftIdentity;
  accessToken: string;
  /** Taken from the trusted OAuth token response, never from decoded Graph JWTs. */
  scopes: readonly string[];
  expiresAt: number;
  /** Explicit optional UTTU Teams connection, separately from normal sign-in. */
  consented: boolean;
  /** Verified storage version used to prevent a different grant claiming a send. */
  connectionVersion?: string;
}

export interface MentionSend {
  enabled: boolean;
  authenticatedAuthor: MicrosoftIdentity;
  recipient: MicrosoftIdentity;
  grant: AuthorGrant | null;
  /** The durable, unique delivery ID claimed atomically by the backend. */
  deliveryId: string;
  /** Rendered from a persisted note snapshot approved in the save/send action. */
  text: string;
  /** Backend-confirmed author action, not an unchecked browser assertion. */
  authorActionConfirmed: boolean;
  /** Atomic DB authorization immediately before the irreversible message POST. */
  authorizeMessage: () => Promise<boolean>;
}

export type MentionSendResult =
  | { status: 'sent'; chatId: string; messageId: string }
  | { status: 'not_sent'; reason: 'disabled' | 'not_authorized' | 'invalid_recipient' | 'invalid_message' }
  | { status: 'reconnect_required' }
  | { status: 'throttled'; retryAfterSeconds: number; phase: 'chat' | 'message' }
  | { status: 'failed'; phase: 'chat' | 'message'; httpStatus?: number }
  | { status: 'unknown'; phase: 'message' };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function validIdentity(identity: MicrosoftIdentity): boolean {
  return isUuid(identity.userId) && isUuid(identity.tenantId) && isUuid(identity.objectId);
}

function hasSendScopes(scopes: readonly string[]): boolean {
  const canonical = new Set(scopes.map(scope => scope.replace(/^https:\/\/graph\.microsoft\.com\//, '')));
  return TEAMS_DELEGATED_SCOPES.every(scope => canonical.has(scope));
}

function retryAfter(value: string | null, now: number): number {
  const clamp = (seconds: number) => Number.isFinite(seconds) ? Math.min(86_400, Math.max(1, seconds)) : 60;
  if (value && /^\d+$/.test(value)) return clamp(Number(value));
  const date = value ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? clamp(Math.ceil((date - now) / 1000)) : 60;
}

/**
 * Server-only Graph transport, called only after an authenticated delivery claim.
 * The caller owns a DB-backed atomic claim and records the terminal result.
 * There are NO automatic POST retries: a timeout/5xx after a message POST may
 * already have delivered it. client-request-id is diagnostic, NOT idempotency.
 */
export async function sendAuthorMention(
  input: MentionSend,
  fetchImpl: Fetch = fetch,
  now: number = Date.now(),
): Promise<MentionSendResult> {
  if (!input.enabled) return { status: 'not_sent', reason: 'disabled' };
  const { grant, authenticatedAuthor: author, recipient } = input;
  if (!input.authorActionConfirmed || !isUuid(input.deliveryId) || !validIdentity(author)) {
    return { status: 'not_sent', reason: 'not_authorized' };
  }
  if (!validIdentity(recipient) || author.tenantId !== recipient.tenantId
    || author.objectId === recipient.objectId || author.userId === recipient.userId) {
    return { status: 'not_sent', reason: 'invalid_recipient' };
  }
  if (!grant?.consented || !sameMicrosoftIdentity(author, grant.identity)
    || !hasSendScopes(grant.scopes) || !Number.isFinite(grant.expiresAt)
    || grant.expiresAt <= now + 30_000
    || !grant.accessToken || /[\r\n]/.test(grant.accessToken)) {
    return { status: 'reconnect_required' };
  }
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 6000) {
    return { status: 'not_sent', reason: 'invalid_message' };
  }

  const post = async (path: string, body: unknown, phase: 'chat' | 'message') => {
    let response: Response;
    try {
      response = await fetchImpl(`${GRAPH}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${grant.accessToken}`,
          'Content-Type': 'application/json',
          'client-request-id': input.deliveryId,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Never expose token, message content, provider response or exception text.
      return { result: phase === 'message'
        ? { status: 'unknown', phase } as const
        : { status: 'failed', phase } as const };
    }
    if (response.status === 401 || response.status === 403) {
      return { result: { status: 'reconnect_required' } as const };
    }
    if (response.status === 429) {
      return { result: { status: 'throttled', phase,
        retryAfterSeconds: retryAfter(response.headers.get('retry-after'), now) } as const };
    }
    if (response.status !== 201 && !(phase === 'chat' && response.status === 200)) {
      return { result: phase === 'message' && response.status >= 500
        ? { status: 'unknown', phase } as const
        : { status: 'failed', phase, httpStatus: response.status } as const };
    }
    try {
      const data: unknown = await response.json();
      const id = data && typeof data === 'object' ? (data as { id?: unknown }).id : null;
      if (typeof id === 'string' && id.length > 0 && id.length <= 1024 && !/[\u0000-\u001f]/.test(id)) {
        return { id };
      }
    } catch { /* A delivered message can have an unreadable response. */ }
    return { result: phase === 'message'
      ? { status: 'unknown', phase } as const
      : { status: 'failed', phase } as const };
  };

  // Graph returns the existing one-on-one chat if this pair already has one.
  // Both exact object IDs come from verified identities. No directory search.
  const chat = await post('/chats', {
    chatType: 'oneOnOne',
    members: [author.objectId, recipient.objectId].map(objectId => ({
      '@odata.type': '#microsoft.graph.aadUserConversationMember',
      roles: ['owner'],
      'user@odata.bind': `${GRAPH}/users('${objectId}')`,
    })),
  }, 'chat');
  if ('result' in chat) return chat.result!;

  try {
    if (typeof input.authorizeMessage !== 'function' || !await input.authorizeMessage()) {
      return { status: 'not_sent', reason: 'not_authorized' };
    }
  } catch { return { status: 'not_sent', reason: 'not_authorized' }; }

  const message = await post(`/chats/${encodeURIComponent(chat.id!)}/messages`, {
    // Do not supply from: Graph derives the actual sender from the user token.
    body: { contentType: 'text', content: input.text },
  }, 'message');
  if ('result' in message) return message.result!;
  return { status: 'sent', chatId: chat.id!, messageId: message.id! };
}
