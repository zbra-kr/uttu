const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-source.cjs');
const { NextRequest } = require('next/server');
const origin = 'https://uttu.example.test';
function handler(options = {}) {
  let exchanges = 0;
  const api = load('src/app/auth/teams/callback/route.ts', {
    '@/lib/teams/config': { teamsConfig: () => options.configMissing ? null : { origin, secure: true } },
    '@/lib/teams/setup-access': { teamsSetupRequired: () => options.required !== false },
    '@/lib/supabase/server': { supabaseServer: async () => ({ auth: {
      getUser: async () => ({ data: { user: options.noUser ? null : { id: 'synthetic-user' } } }),
    } }) },
    '@/lib/teams/oauth': {
      connectCookie: secure => secure ? '__Host-uttu-teams-connect' : 'uttu-teams-connect',
      teamsConnectReturnPath: () => '/ranking?brand=a#chart',
      completeTeamsConnect: async () => { exchanges++; if (options.exchangeError) throw new Error('synthetic-private-detail'); return options.next || '/ranking?brand=a#chart'; },
    },
  });
  const request = (query = '?code=synthetic-code&state=synthetic-state') => new NextRequest(origin + '/auth/teams/callback' + query, {
    headers: options.noCookie ? {} : { Cookie: '__Host-uttu-teams-connect=synthetic-sealed-attempt' },
  });
  return { ...api, request, exchanges: () => exchanges };
}
test('successful required connection returns to the original safe app destination', async () => {
  const api = handler(); const response = await api.GET(api.request());
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), origin + '/ranking?brand=a#chart');
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(api.exchanges(), 1);
});
for (const [label, options, query, calls] of [
  ['user cancelled', {}, '?error=access_denied&state=synthetic-state&error_description=private', 0],
  ['MFA/interaction required', {}, '?error=interaction_required&state=synthetic-state', 0],
  ['missing attempt', { noCookie: true }, undefined, 0],
  ['expired session', { noUser: true }, undefined, 0],
  ['wrong/expired/revoked exchange', { exchangeError: true }, undefined, 1],
  ['unavailable configuration', { configMissing: true }, undefined, 0],
]) test(`${label} returns a stable setup error without automatically repeating OAuth`, async () => {
  const api = handler(options); const response = await api.GET(api.request(query));
  const target = new URL(response.headers.get('location'));
  assert.equal(target.pathname, '/setup/teams');
  assert.equal(target.searchParams.get('error'), 'oauth'); assert.equal(target.searchParams.get('attempted'), '1');
  assert.doesNotMatch(target.toString(), /private|synthetic-state|synthetic-code/);
  assert.equal(api.exchanges(), calls);
});
test('optional connection failure keeps its existing profile feedback', async () => {
  const api = handler({ required: false, exchangeError: true });
  assert.equal((await api.GET(api.request())).headers.get('location'), origin + '/me?teams=failed');
});
test('forged or looping successful destinations still cannot leave the application', async () => {
  for (const next of ['https://evil.example', '//evil.example', '/setup/teams', '/api/me/notes']) {
    const api = handler({ next }); assert.equal((await api.GET(api.request())).headers.get('location'), origin + '/');
  }
});
