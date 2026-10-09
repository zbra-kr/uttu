export const MATCHING_GUARD_HEADER = 'X-UTTU-Matching-Guard';

/** Only explicitly marked matching requests require stricter SDK response handling. */
export async function fetchWithMatchingGuard(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const mode = headers.get(MATCHING_GUARD_HEADER);
  // This is a local SDK-to-transport marker; never send it to the server/CORS layer.
  if (mode !== null) headers.delete(MATCHING_GUARD_HEADER);
  const response = await fetch(input, mode === null ? init : { ...init, headers });
  if (mode === null) return response;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const matchingRead = method === 'GET' && (mode === 'read' || mode === 'complete-read');
  const matchingMutation = mode === 'mutation' && ['POST', 'PATCH', 'DELETE'].includes(method);
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!url.pathname.startsWith('/rest/v1/') || (!matchingRead && !matchingMutation)) return response;
  const invalid = async () => {
    await response.body?.cancel().catch(() => {});
    return new Response(JSON.stringify({
      code: 'UTTU_MATCHING_RESPONSE', message: 'PostgREST HTTP response could not be verified',
    }), { status: 400, headers: { 'content-type': 'application/json' } });
  };
  // Locked SDK normalizes array-body 404 to 200/[] and empty-body 404 to 204/null.
  if (response.status === 404) return invalid();
  if (!response.ok || mode !== 'complete-read') return response;
  if (!headers.get('Prefer')?.includes('count=exact')) return invalid();

  // The SDK exposes the total count but discards the returned range boundaries.
  const range = response.headers.get('content-range');
  const parsed = range?.match(/^(\d+)-(\d+)\/(\d+)$|^\*\/(0)$/);
  const offset = Number(url.searchParams.get('offset') ?? '0');
  const limit = Number(url.searchParams.get('limit'));
  if (!parsed || !Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(limit) || limit <= 0) return invalid();
  const total = Number(parsed[3] ?? parsed[4]);
  if (!Number.isSafeInteger(total) || total < 0) return invalid();
  if (total === 0) return parsed[4] === '0' && offset === 0 ? response : invalid();
  const start = Number(parsed[1]);
  const end = Number(parsed[2]);
  if (start !== offset || !Number.isSafeInteger(end) || end !== Math.min(offset + limit, total) - 1) return invalid();
  return response;
}
