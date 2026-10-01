# Required Teams setup

This release adds an optional rollout gate, `TEAMS_CONNECTION_REQUIRED=true`,
for UTTU web pages and authenticated app API routes. It defaults off. The existing
`TEAMS_MENTIONS_ENABLED=true` flag and valid server configuration are prerequisites.
It does not change Supabase data RLS, Auth hooks, quotas, names, OAuth-server/MCP
continuations, or the independent notification scheduler/cutoff.

An authenticated user's protected `profiles.role='admin'` preserves emergency
administrator access, including email/password login. Other users need a genuine
Teams connection before entering the web app. Existing unconnected users reach
setup on their next request. Setup, authentication callbacks, password recovery,
the connection endpoint and local-session logout remain accessible.

## Login and consent

After Microsoft login, `/setup/teams` checks status on the server and returns an
already connected user to their safe original destination. An unconnected user
automatically starts one Teams authorization round trip. Reload/back, cancellation
and errors show an explicit retry instead of starting a loop. Microsoft may still
require account selection, MFA or another interaction. No message is sent by setup.

The existing company tenant and application remain pinned. Teams authorization
requests `openid email profile offline_access`, delegated `Chat.Create`, and
delegated `ChatMessage.Send`. The forced `prompt=consent` was removed so Microsoft
can reuse existing user/tenant consent and SSO. Ordinary Supabase login still asks
only for basic email/profile identity; Graph refresh tokens stay in the separate
server-encrypted Teams store.

Tenant administrator pre-consent does not create individual refresh tokens. Each
user still completes the authorization-code flow. The reviewed Entra configuration
contains only delegated `Chat.Create`, `ChatMessage.Send`, `offline_access`,
`email`, and `openid`; the existing basic-identity grants are preserved. Do not
approve extra scopes or application permissions through a broad consent action.

References: [admin consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent),
[authorization code and SSO](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow),
[refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens).

## Server checks

Migration `01507_teams_required_setup_status.sql` introduces one authenticated,
own-actor metadata RPC. It checks the protected role, trusted Azure identity,
current connection epoch, required scopes and known reconnect evidence. It never
returns tokens, ciphertext or another user's identity. The app also authenticates
the AES-GCM envelope, exact identity/epoch and token-bundle shape using WebCrypto;
caller-writable connection metadata alone cannot prove completed OAuth.

The status result's connection version must match the separately fetched sealed
grant before the app can proceed. Access-token expiry alone does not mean consent
has disappeared: the existing send path refreshes normally. Revocation can be
discovered on provider use; a known failed sealed grant requires reconnect.

A private correlation fingerprint is added to the existing mention-delivery
ledger when a grant is claimed. Replaying the same sealed value under a new DB
version cannot clear its recorded reconnect failure. Fresh OAuth/refresh ciphertext
is independent of old failures. Canonical encoding and AES-GCM authentication
prevent equivalent-encoding or fabricated-value shortcuts. Fingerprints do not
authorize tokens and are never sent to Graph.

The send path binds its loaded grant version to the claimed delivery before any
Graph call. A concurrent connection change skips that submission without marking
the new grant unhealthy. Existing skipped, sent, failed and unknown submissions
are never replayed by setup or deployment.

## Rollout and verification

1. Apply only the reviewed `01507` in an explicit transaction, with bounded lock
   and statement timeouts. It locks the mention ledger before preflight and aborts
   if a claim is in progress, the prior claim function has drifted, or old unhealthy
   evidence cannot be matched safely. Let live claims finish; do not change them.
2. Preserve all existing private-table/RPC ACLs, protected role logic and the
   notification cutoff. Read back the exact status/claim functions and new narrow
   grant. Do not reset `01505`, `01506`, connection epochs or either delivery ledger.
3. Publish the exact reviewed source and verify Auth, Teams, SQL, type, lint and
   production build checks. Keep the separate guided-tour changes out of this release.
4. Enable only `TEAMS_CONNECTION_REQUIRED=true` in Vercel Production and deploy
   the verified commit. Retain Microsoft-only login and the admin fallback.
5. Verify anonymous login, admin access, an unconnected Microsoft user's setup,
   cancellation/retry, a connected user's deep link and protected API status428.
   Existing public stats/MCP paths and password recovery retain their behavior.
6. The user's actual OAuth round trip verifies the live provider credential.
   Real DM testing still requires an approved recipient/message or the user's own
   deliberate fresh submission. Local tests use synthetic credentials and providers.

To pause enforcement, set `TEAMS_CONNECTION_REQUIRED=false` and deploy. Keep grant
and delivery history. Schema rollback is a reviewed operation, after disabling
the gate; it must precede any `01505` rollback and must not erase live send evidence.
