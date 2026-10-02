const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadSource = require('./helpers/load-source.cjs');
const { TOUR_STEPS, isTourState, shouldAutoStart, clampSpotlight, positionCallout } = loadSource('src/lib/onboarding/tour.ts');
const root = path.join(__dirname, '..');
const source = p => fs.readFileSync(path.join(root, p), 'utf8');

test('six deliberate steps target real AI and saved bookmarks surfaces', () => {
  assert.equal(TOUR_STEPS.length, 6);
  assert.equal(TOUR_STEPS[0].target, 'ai-entry');
  assert.equal(TOUR_STEPS[1].target, 'ai-input');
  assert.equal(TOUR_STEPS[2].route, '/ranking');
  assert.equal(TOUR_STEPS[5].route, '/me');
  assert.equal(TOUR_STEPS[5].target, 'saved-bookmarks');
  assert.ok(TOUR_STEPS.every(s => !s.route?.includes('chat')));
});
test('only eligible pending new accounts automatically start', () => {
  for (const eligible of [true, false]) for (const status of ['pending', 'legacy', 'completed', 'skipped']) for (const dismissed of [true, false]) {
    assert.equal(shouldAutoStart({ userId: 'a', eligible, status, step: 0 }, dismissed), eligible && status === 'pending' && !dismissed);
  }
});
test('server state validation never turns malformed data into enrollment', () => {
  const state = {userId: 'a', eligible: true, status: 'pending', step: 0};
  assert.equal(isTourState(state), true);
  for (const invalid of [null, [], {}, { ...state, eligible: 'true' }, { ...state, userId: 3 }, { ...state, step: -1 }, { ...state, step: 6 }, { ...state, step: 0.5 }, { ...state, status: 'active' }]) assert.equal(isTourState(invalid), false);
});
test('spotlight clamps edges and unavailable or offscreen elements', () => {
  assert.deepEqual(clampSpotlight({ left: 0, top: 0, width: 56, height: 56 }, 390, 844), { left: 4, top: 4, width: 58, height: 58 });
  assert.equal(clampSpotlight({ left: 400, top: 0, width: 20, height: 20 }, 390, 844), null);
  assert.equal(clampSpotlight({ left: 0, top: -100, width: 20, height: 20 }, 390, 844), null);
});
test('callout fits desktop, mobile, lower FAB and absent targets', () => {
  for (const viewport of [{width:1280,height:800},{width:390,height:844},{width:320,height:568},{width:390,height:360}]) {
    const card = { width: Math.min(380,viewport.width-32),height:Math.min(400,viewport.height-32) };
    for (const target of [null, {left:viewport.width-72,top:viewport.height-76,width:56,height:56}, {left:20,top:40,width:100,height:30}]) {
      const position = positionCallout(target,viewport,card);
      assert.ok(position.left >= 16 && position.top >= 16);
      assert.ok(position.left+card.width <= viewport.width-16+0.1);
      assert.ok(position.top+Math.min(card.height, position.maxHeight) <= viewport.height-16+0.1);
    }
  }
});
test('practice is isolated from all business writes and AI sends', () => {
  const overlay = source('src/components/onboarding/TourOverlay.tsx');
  assert.doesNotMatch(overlay, /\bfetch\s*\(|supabase|createNote|addBookmark|notify-mentions|\/api\/ai\/chat/);
  assert.match(overlay, /연습 · 메모 저장 및 Teams 전송 없음/);
  assert.match(overlay, /연습 · AI 사용량 차감 없음/);
  assert.match(overlay, /연습 · 실제 목록에는 저장되지 않음/);
});
test('modal uses native inertness, Escape and explicit keyboard trapping', () => {
  const overlay = source('src/components/onboarding/TourOverlay.tsx');
  assert.match(overlay, /el\.showModal\(\)/);
  assert.match(overlay, /aria-modal="true"/);
  assert.match(overlay, /onCancel=.*onSkip\(\)/);
  assert.match(overlay, /e\.stopPropagation\(\)/);
  assert.match(overlay, /e\.key !== 'Tab'/);
  assert.match(overlay, /title\.current\?\.focus/);
  assert.match(source('src/components/onboarding/tour.module.css'), /prefers-reduced-motion: reduce/);
});
test('shell uses tour-only AI visibility without saving existing preferences', () => {
  assert.match(source('src/components/shell/ShellClient.tsx'), /tour\.active \? tour\.step === 1 : undefined/);
  assert.match(source('src/components/shell/MobileShell.tsx'), /tour\.active \? tour\.step === 1 : aipOpen/);
  assert.match(source('src/components/help/HelpDrawer.tsx'), /tour\.replay\(\)/);
});
test('progress has ordered writes, account boundaries and unchanged browser-history exit', () => {
  const provider = source('src/components/onboarding/OnboardingProvider.tsx');
  assert.match(provider, /queue\.current = queue\.current\.catch/);
  assert.match(provider, /generation\.current !== epoch/);
  assert.match(provider, /uttu-tour:v1:\$\{id\}:dismissed/);
  assert.match(provider, /popstate/);
  assert.match(provider, /finish\('skipped', false\)/);
  assert.doesNotMatch(provider, /router\.push/);
  assert.match(provider, /restoreRoute && \(wasNavigating \|\| origin\.current/);
  assert.match(provider, /routePending\.current = wasNavigating \|\| route/);
  assert.match(provider, /tourNavigationPath\(requestedRoute, origin\.current\) : origin\.current/);
  assert.match(provider, /expectedUrl\.current = route/);
});
