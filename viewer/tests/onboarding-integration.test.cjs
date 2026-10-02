const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NextRequest } = require('next/server');
const load = require('./helpers/load-source.cjs');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function middleware(allowed, signedIn = true) {
  return load('src/middleware.ts', {
    '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'verified-user' } : null } }) } }) },
    '@/lib/teams/setup-access': { teamsSetupRequired: () => true,
      readTeamsSetupAccess: async () => ({ decision: { allowed } }) },
  }).middleware;
}
for (const method of ['GET', 'PATCH', 'POST']) {
  test(`onboarding ${method} remains behind the mandatory Teams gate`, async () => {
    const response = await middleware(false)(new NextRequest('https://uttu.test/api/me/onboarding', { method }));
    assert.equal(response.status, 428);
    assert.equal((await response.json()).error, 'teams_setup_required');
  });
  test(`onboarding ${method} permits the existing connected/admin decision`, async () => {
    assert.equal((await middleware(true)(new NextRequest('https://uttu.test/api/me/onboarding', { method }))).status, 200);
  });
}
test('tour layout never wraps Teams setup, login or OAuth callbacks', () => {
  assert.match(source('src/app/(app)/layout.tsx'), /OnboardingProvider/);
  for (const file of ['src/app/layout.tsx','src/app/setup/teams/page.tsx','src/app/auth/callback/route.ts','src/app/auth/teams/callback/route.ts']) assert.doesNotMatch(source(file), /OnboardingProvider|TourOverlay/);
});
test('the preserved ranking memo anchor keeps source context and save restrictions', () => {
  const ranking = source('src/app/(app)/ranking/page.tsx');
  assert.match(ranking, /data-tour="note-entry"/);
  assert.match(ranking, /sourceContext=/);
  assert.match(ranking, /saveBlockedReason=/);
  assert.match(ranking, /compact=\{isMobile\}/);
});
test('new mobile source memo entry and exact target logic are retained', () => {
  for (const name of ['product','brand','company']) {
    const file = `src/app/(app)/${name}/Mobile${name[0].toUpperCase()+name.slice(1)}DetailView.tsx`;
    assert.match(source(file), /useSourceNoteDrawer/);
    assert.match(source(file), /<NoteDrawer/);
    assert.match(source(file), /setNoteDrawerOpen\(true\)/);
  }
});
test('onboarding migration does not collide with required setup or note source context', () => {
  const migrations = fs.readdirSync(path.join(root, '../supabase/migrations'));
  for (const name of ['01507_teams_required_setup_status.sql','01508_note_source_context.sql','01509_guided_onboarding.sql']) assert.ok(migrations.includes(name));
  assert.ok(!migrations.includes('01507_guided_onboarding.sql'));
});

const { tourNavigationPath, tourReturnPath, TOUR_RETURN_PARAM } = load('src/lib/onboarding/navigation.ts');
for (const destination of ['/ranking','/me']) test(`page redirect before API handoff preserves source via ${destination}`, async () => {
  const original = '/product?no=123#details';
  const response = await middleware(false)(new NextRequest('https://uttu.test'+tourNavigationPath(destination,original)));
  assert.equal(response.status,307);
  const setup = new URL(response.headers.get('location'));
  assert.equal(setup.pathname,'/setup/teams');
  assert.equal(setup.searchParams.get('next'),original);
});
test('tour return markers cannot redirect outside the app or into setup/auth/API loops', () => {
  for (const bad of ['https://evil.test','//evil.test','/setup/teams','/auth/callback','/api/me/onboarding','/login','/%61uth/callback']) {
    assert.equal(tourReturnPath('/ranking?'+new URLSearchParams({[TOUR_RETURN_PARAM]:bad})), '/');
  }
  assert.equal(tourReturnPath('/ranking?uttu_tour_return=%2Fme&uttu_tour_return=%2Fproduct'),'/ranking');
  assert.equal(tourReturnPath('/ranking?'+new URLSearchParams({[TOUR_RETURN_PARAM]:'/me?uttu_tour_return=%2Fproduct'})),'/me');
  assert.equal(tourReturnPath('/product?no=123&uttu_tour_return=%2Fme'),'/product?no=123&uttu_tour_return=%2Fme');
});
test('tour setup return compacts saved memo links through the existing canonical permalink', () => {
  const note = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const link = tourNavigationPath('/ranking',`/product?no=123&note=${note}&notes=open`);
  assert.equal(tourReturnPath(link),`/me/notes/${note}`);
});
