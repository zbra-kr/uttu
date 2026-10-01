# Author-sent Teams mention DMs

## Status and behavior

Rebased and tested with the name-normalization release
`b4262ac4a2ade21675b35087ed8fcfb40179ca23` and the separate notification-only
`01506_notification_dispatch_edge.sql` migration in either application order.
See [disabled release checklist](TEAMS_DISABLED_RELEASE.md) for staged publication.
No live Entra permissions, redirect URIs, credentials, database objects, worker,
deployment settings, or Teams messages have been changed by this implementation.
Sending is disabled unless `TEAMS_MENTIONS_ENABLED=true` and all server settings
are valid. The database migration is a prerequisite for the updated in-app
mention notification endpoint, including when Teams sending is disabled.

- A user connects Teams explicitly from their profile. Ordinary Microsoft login
  continues to request only the existing basic identity scopes.
- A newly submitted note displays its exact selected people and the option
  “내 계정 명의로 Teams DM 보내기 (메모 내용과 링크)”. The submit button makes
  the send action visible. The author can uncheck it.
- The DM contains the submitted note text and an authenticated UTTU note link.
  Graph determines the sender from the author's delegated access token. The app
  never supplies a `from` field or uses a bot/application token.
- Individual selections only: team-wide mentions remain in-app notifications.
  A submission can send to at most 10 selected people. Self mentions are excluded.
  An unmapped Microsoft account, recipient opt-out, or missing consent skips DM
  delivery without a webhook/bot fallback. Editing a note does not resend it.
- Existing mention webhook delivery must be stopped before activation. For the
  notification-only Edge migration, stop every Mac dispatcher schedule and let
  in-flight calls finish; the Edge dispatcher permanently excludes Teams mentions.
  The included Python exclusion is defense-in-depth in source, not proof that the
  old running Mac process has stopped. Other alert event types remain unchanged.
- Teams keeps its own message copy. Deleting a UTTU note does not remove that
  copy. The note deep link remains protected by existing owner/mentioned-user RLS.

## Least-privilege Microsoft configuration

Use the existing single-tenant registration:

- Tenant: `09cefcf6-a744-4cc2-a8ec-681fe0d1a85a`
- Application/client ID: `9606242c-c22e-453b-a65a-bcb33b59b5d3`
- Add a **Web** redirect URI: `https://uttu.bcave.ai/auth/teams/callback`
- Preserve the existing Supabase callback and single-tenant restriction
- Delegated Microsoft Graph scopes: `Chat.Create`, `ChatMessage.Send`
- OIDC scopes: `openid email profile offline_access`

`Chat.Create` creates or returns the existing one-on-one chat for the exact pair.
`ChatMessage.Send` sends as the signed-in user. `Chat.ReadWrite`, chat read access,
directory-wide access, application permissions, a Teams bot and webhook secrets
are not needed. These two delegated scopes do not inherently require admin
consent, but tenant consent policy can still require administrator approval.
[Create chat](https://learn.microsoft.com/en-us/graph/api/chat-post?view=graph-rest-1.0),
[Send chat message](https://learn.microsoft.com/en-us/graph/api/chat-post-messages?view=graph-rest-1.0),
[Permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference#chatmessagesend)

The optional connection is a separate server-side authorization-code flow with
PKCE, state and nonce. It validates the ID-token signature (RS256), exact issuer,
audience, expiry, nonce and the current UTTU account's object/tenant IDs. Selecting
a different Microsoft account cannot attach its grant to the logged-in author.
[Authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

## Server settings and credential handoff

Required settings, all server-only except the existing public app URL:

| Name | Value/purpose |
| --- | --- |
| `TEAMS_MENTIONS_ENABLED` | Exact `true` only after all rollout gates below |
| `TEAMS_MICROSOFT_CLIENT_SECRET` | Confidential-client credential for the existing app |
| `TEAMS_TOKEN_ENCRYPTION_KEY` | Dedicated 32-byte random key encoded as standard base64 |
| `TEAMS_MICROSOFT_TENANT_ID` | Optional; defaults to the pinned company tenant above |
| `TEAMS_MICROSOFT_CLIENT_ID` | Optional; defaults to the pinned existing app above |
| `NEXT_PUBLIC_APP_URL` | Existing canonical `https://uttu.bcave.ai` |

The implementation deliberately does not create, retrieve, print or configure
credentials. Before activation, the owner must approve the exact persistent
permission changes and supply the app credential and encryption key through the
deployment platform's secure secret-entry flow. Do not paste them in chat,
commit them, put them in a `NEXT_PUBLIC_*` variable, or expose them to the browser.
If the existing app secret is no longer available, creating another credential
needs its own explicit approval and secure handoff.

The same app's confidential-client credential authenticates its delegated token
exchange and refresh. This is not a `client_credentials` or application-permission
sender. A Supabase service-role key is not used by the new Teams routes.

## Token lifecycle and identity

Supabase does not persist or refresh provider tokens for an application, and its
Azure refresh-token return requires `offline_access`. Rather than allowing those
tokens into the Supabase browser-session cookie, this implementation performs the
optional Teams OAuth exchange entirely on the server.
[Supabase social provider tokens](https://supabase.com/docs/guides/auth/social-login#provider-tokens),
[Supabase Azure scopes](https://supabase.com/docs/guides/auth/social-login/auth-azure#obtain-the-provider-refresh-token)

The token bundle is AES-256-GCM encrypted before any database RPC. Associated data
binds it to the UTTU user, tenant, object ID and consent epoch. The database stores
only ciphertext plus non-secret lifecycle fields. A key is supplied exclusively
through server configuration. OAuth attempt cookies are encrypted, HttpOnly,
Secure in production, SameSite=Lax and expire after ten minutes; they contain
PKCE/state/nonce information, never Microsoft access/refresh tokens.

An authenticated mention action refreshes an expiring token on demand. A version
compare-and-swap preserves the winning refresh. Disconnect atomically deletes the
grant, cancels not-yet-started deliveries and rotates a durable consent epoch.
Neither an old refresh nor an already-started initial callback can restore a
disconnected connection. Old captured ciphertext also fails epoch-bound
decryption after reconnect. A revoked/expired grant requires reconnection.
[Microsoft refresh-token lifecycle](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)

Names, emails, UPNs and Supabase's Azure `sub`/`provider_id` are never recipient
addresses. The mapping uses verified `auth.identities` Azure
`identity_data.custom_claims.oid/tid` and exact top-level `iss`. Missing or
ambiguous identities fail closed. Normal UPN/email changes retain routing when
the same Entra object remains; an account deleted and recreated has a new object
ID and needs fresh authentication/mapping. No email guessing is performed.
[Microsoft immutable identity claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference),
[Supabase Azure claim parser](https://github.com/supabase/auth/blob/master/internal/api/provider/oidc.go#L289-L344)

## Authorization, deduplication and failures

The new tables have RLS and no direct API-role privileges. Narrow security-definer
RPCs have fixed search paths and require the authenticated actor's `auth.uid()` to
match the note author. Private helpers have no API execute privileges. Ciphertext
can be retrieved only for its owning actor; no other user's tokens are readable.

The prepare transaction compares the submitted body and normalized recipient
UUID list against a locked current note before snapshotting. The unique
note/author/recipient ledger adopts an existing inbox record without duplicating
it. An unchecked, stale (over five minutes), oversized or ineligible submission
cannot later be upgraded by request replay. The ledger survives note deletion,
so deleting and recreating a note ID cannot erase send deduplication.

A claimed delivery rechecks membership, unchanged note body, verified identities,
connection and recipient settings. After chat creation returns, an atomic
`begin_send` check runs immediately before the message POST, so disconnect or
edits during chat creation prevent the message. A send already past this boundary
can finish; the disconnect UI states that limitation.

Only a definite Graph response with a message ID marks the inbox sent. Timeout,
unreadable success responses and message-POST 5xx are `unknown`. They are never
automatically retried. Graph does not document message-POST idempotency;
`client-request-id` is diagnostic only. A 429 records the Retry-After deadline but
does not silently replay the message. There is no exactly-once delivery claim and
no read scope added merely to reconcile an uncertain send.
[Graph throttling](https://learn.microsoft.com/en-us/graph/throttling)

Already-open pre-release browser tabs may submit only `note_id`. That exact
legacy shape remains authenticated, owner-checked and in-app-only even after
Teams is enabled. It cannot request a DM. Partial/new Teams requests still need
the complete reviewed body and recipient UUIDs; they never inherit legacy consent.

The composer reuses one submission UUID after an uncertain insert response and
blocks repeated saves while pending. Selected mention ranges carry UUIDs; editing
or deleting a token removes its recipient. Ambiguous duplicate-name edits clear
those selections rather than guessing the surviving person.

## Verification and rollout gates

1. Review the entire change against the final auth/name-normalization head.
2. Apply `01505_teams_delegated_mentions.sql` atomically after review. The matching
   rollback removes the new feature objects only. Its ACL preflight fails closed.
3. Before activation, verify every old dispatcher schedule is stopped and all
   in-flight processes have drained. Publishing the Python exclusion alone does
   not establish this. The new Edge dispatcher must continue excluding Teams
   mentions and preserving its database-generated future-only cutoff.
4. Publish the Viewer with the feature still disabled. Verify ordinary Microsoft
   login, admin fallback and in-app mentions remain intact.
5. Approve/configure the exact Web redirect, delegated permissions and server
   secrets described above. Do not broaden tenant or ordinary login scopes.
6. Enable the feature, let each sender explicitly connect, and verify disconnect
   works even if the feature is subsequently disabled.
7. Only after a named recipient and exact test message are explicitly approved,
   test one real DM. Verify the Teams sender is the mention author, recipient and
   content are correct, and repeated request delivery does not duplicate it.

Local commands:

```sh
cd viewer
npm run test:auth
npm run test:teams
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

SQL tests use the repository's existing PGlite test harness pattern:

```sh
UTTU_PGLITE_MODULE=/path/to/@electric-sql/pglite \
  node supabase/tests/run_teams_delegated_mentions.cjs
```

All network behavior in automated tests is mocked, including Graph, token
exchange, and signing-key retrieval. The ID-token test uses a generated ephemeral
RSA test key and the real `jose` verifier. Local SQL tests cover competing state
transitions; hosted multi-session concurrency, tenant policy, Teams licensing,
live OAuth consent and actual DM delivery still require the controlled rollout.
