import 'server-only';
import { centralState, parseCentralScope } from './central-sales-read';
import { createCentralRestExecutor, type SnowflakeRestBinding } from './central-sales-rest';
import { prepareRequesterReview, readRequesterLocalSales } from './requester-local-review';
import type { CentralActor } from './central-sales-server';
export interface RequesterRestBinding { expectedRequesterId: string; rest: SnowflakeRestBinding | null }
export async function readAuthenticatedRequesterRestSales(input: unknown, binding: RequesterRestBinding,
  currentActor: () => Promise<CentralActor | null>, http: typeof fetch = fetch) {
  const parsed = parseCentralScope(input);
  if (parsed.reason) return centralState('request', null, parsed.reason);
  const scope = parsed.scope!; const expectedRequesterId = binding.expectedRequesterId; const rest = binding.rest;
  // Auth before constructing transport or touching signer/HTTP.
  const deps = { currentActor, executor: null };
  const context = await prepareRequesterReview(scope, expectedRequesterId, deps);
  if (!context) return readRequesterLocalSales(scope, context, deps);
  try { return await readRequesterLocalSales(scope, context, { currentActor, executor: rest ? createCentralRestExecutor(rest, http) : null }); }
  catch { return centralState('error', scope, 'READ_FAILED'); }
}
