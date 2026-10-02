# Teams mention source links

Mention DMs retain the existing author-delegated Graph flow, reviewed body and
recipient checks, connection-version binding, atomic send boundary, and delivery
ledger. No OAuth permission, transport retry, historical replay, or real test
message is introduced.

The message uses Graph `body.contentType: html` with three simple paragraphs:
source page title, escaped note text with preserved line breaks, and a labeled
UTTU link. HTML is created only by the server formatter. Text, database titles,
and href attributes are escaped, Unicode is not split, and encoded HTML is
bounded to 24,000 UTF-8 bytes. The href uses the deployment-owned origin and an
allowlisted internal route. `@name` remains the selected note's literal text;
this does not invent a Graph mention identity.

Source links use authenticated product/company/brand lookups and validated,
versioned ranking context. Product UUIDs resolve to the page's `musinsa_no`.
Missing/deleted/unsupported sources keep the existing RLS-bound note page.
Authentication compacts source links to the persisted `/me/notes/{id}` permalink
before OAuth, avoiding oversized redirect URLs and sealed cookies; the resolver
restores the full context afterward. Older `/me/notes/{id}` links resolve to supported sources, so existing in-app
alerts and sent links continue to work without rewriting notification history.
Only the author and mentioned users can fetch the note. A source URL alone does
not bypass that policy.

New ranking notes persist only allowlisted filter state in `source_context`.
No arbitrary URL, title, credentials, or browser storage is stored. The original
four-field ranking entity grouping remains unchanged. Stored absolute query
dates pin the selected data range when possible. Legacy ranking notes can
restore only age/category/gender/period; unavailable filters use explicit defaults
and the page explains that the context is partial. Legacy custom-date notes
cannot recreate absent dates and remain on the secure note fallback.

The source drawer loads the exact RLS-visible target, including one older than
the latest 50, checks its entity, focuses/highlights it, and handles missing or
unauthorized notes without exposing their contents. Source navigation, Close,
Back/Forward, and mobile detail views preserve access to the target memo.

## Ordered rollout

1. Review and apply only `01508_note_source_context.sql` before publishing the
   app code. Use one explicit transaction with bounded local lock/statement
   timeouts. Verify the new nullable JSONB column and bounded-object constraint.
   The migration adds no grants, RLS policies, functions, ledger entries, or
   backfills. Existing rows remain null.
2. Publish the exact reviewed app commit and run Viewer auth/Teams regression
   tests, type checks, lint, build, and required remote CI for that commit.
   App code now reads/writes the new column; code-first deployment is unsafe.
3. Verify generated canonical destinations and authenticated return paths using
   synthetic tests. Any real Teams DM requires the user's fresh save/send action
   or separately approved recipient and text. Never replay the earlier example.
4. For an app rollback, keep the nullable column and recorded context in place.
   The previous app ignores it. Dropping it would destroy saved context and is
   neither necessary nor part of this release.

## Local verification

- `cd viewer && npm run test:teams && npm run test:auth`
- `cd viewer && npx tsc --noEmit --incremental false && npm run lint`
- `cd viewer && npm run build` with synthetic Supabase build placeholders
- `UTTU_PGLITE_MODULE=/path/to/@electric-sql/pglite node supabase/tests/run_note_source_context.cjs`

Official Graph references:
- https://learn.microsoft.com/en-us/graph/teams-messaging-overview
- https://learn.microsoft.com/en-us/graph/api/resources/chatmessage?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/chatmessage-post?view=graph-rest-1.0
