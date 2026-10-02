'use client';
import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { isTourState, shouldAutoStart, TOUR_STEPS } from '@/lib/onboarding/tour';
import TourOverlay from './TourOverlay';
import { tourNavigationPath, tourReturnPath } from '@/lib/onboarding/navigation';
import { teamsSetupPath } from '@/lib/teams/setup-navigation';

type TourContext = { active: boolean; step: number; replay: () => void };
const Context = React.createContext<TourContext>({ active: false, step: 0, replay: () => {} });
export const useOnboarding = () => React.useContext(Context);
const dismissedKey = (id: string) => `uttu-tour:v1:${id}:dismissed`;

export default function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [saveWarning, setSaveWarning] = React.useState(false);
  const account = React.useRef<string | null>(null);
  const generation = React.useRef(0);
  const queue = React.useRef<Promise<unknown>>(Promise.resolve());
  const origin = React.useRef<string>('/');
  const expectedUrl = React.useRef<string | null>(null);
  const routePending = React.useRef(false);
  const activeRef = React.useRef(false);
  const actionLock = React.useRef(0);
  const setupBlocked = React.useRef(false);
  const returnFocus = React.useRef<HTMLElement | null>(null);

  const open = React.useCallback((index: number) => {
    origin.current = tourReturnPath(window.location.pathname + window.location.search + window.location.hash);
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSaveWarning(false);
    setStep(index);
    activeRef.current = true;
    setActive(true);
    const route = TOUR_STEPS[index].route;
    const destination = route ? tourNavigationPath(route, origin.current) : null;
    expectedUrl.current = destination ?? window.location.pathname + window.location.search + window.location.hash;
    routePending.current = !!destination && destination !== window.location.pathname + window.location.search + window.location.hash;
    if (routePending.current) router.replace(destination!, { scroll: false });
  }, [router]);

  const handoffToSetup = React.useCallback((status: number, body: unknown, returnPath?: string) => {
    if (status !== 428 || !body || typeof body !== 'object' || (body as { error?: unknown }).error !== 'teams_setup_required') return false;
    if (setupBlocked.current) return true;
    const nextPath = returnPath ?? (activeRef.current ? origin.current : window.location.pathname + window.location.search + window.location.hash);
    setupBlocked.current = true;
    activeRef.current = false;
    setActive(false);
    setSaveWarning(false);
    generation.current++;
    expectedUrl.current = null;
    routePending.current = false;
    // A revoked/expired mandatory connection outranks the tour. Do not mark it
    // skipped/completed or trust a response-supplied redirect destination.
    router.replace(teamsSetupPath(nextPath), { scroll: false });
    return true;
  }, [router]);

  const save = React.useCallback((body: object, method = 'PATCH') => {
    const id = account.current;
    const epoch = generation.current;
    const returnPath = origin.current;
    // Keep writes ordered so rapid navigation never overwrites completion with an older step.
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (!id || setupBlocked.current || account.current !== id || generation.current !== epoch) return;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('/api/me/onboarding', { signal: controller.signal, method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
        const result: unknown = await response.json();
        if (account.current !== id || generation.current !== epoch) return;
        if (handoffToSetup(response.status, result, returnPath)) return;
        setSaveWarning(!response.ok || !isTourState(result) || result.userId !== id);
      } catch { if (account.current === id && generation.current === epoch) setSaveWarning(true); }
      finally { clearTimeout(timeout); }
    });
  }, [handoffToSetup]);

  React.useEffect(() => {
    let cancelled = false;
    const client = supabaseBrowser();
    const load = async (id: string | null) => {
      if (cancelled || id === account.current) return;
      account.current = id;
      setupBlocked.current = false;
      expectedUrl.current = null;
      routePending.current = false;
      returnFocus.current = null;
      const returnPath = tourReturnPath(window.location.pathname + window.location.search + window.location.hash);
      const epoch = ++generation.current;
      activeRef.current = false;
      setActive(false);
      setSaveWarning(false);
      if (!id) return;
      try {
        const response = await fetch('/api/me/onboarding', { cache: 'no-store' });
        const result: unknown = await response.json();
        if (cancelled || epoch !== generation.current) return;
        if (handoffToSetup(response.status, result, returnPath)) return;
        if (!response.ok || !isTourState(result) || result.userId !== id) return;
        let dismissed = false;
        try { dismissed = sessionStorage.getItem(dismissedKey(id)) === 'true'; } catch {}
        if (!activeRef.current && shouldAutoStart(result, dismissed)) open(result.step);
      } catch { /* An unavailable migration/network must never interrupt the app. Replay still works. */ }
    };
    let authEventSeen = false;
    void client.auth.getUser().then(({ data }) => { if (!authEventSeen) void load(data.user?.id ?? null); }).catch(() => {});
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      // Do not call Supabase methods inside its auth callback.
      authEventSeen = true;
      void load(session?.user.id ?? null);
    });
    return () => {
      cancelled = true;
      // Intentionally invalidate every request, rather than restore an old ref value.
      generation.current++; // eslint-disable-line react-hooks/exhaustive-deps
      account.current = null;
      subscription.unsubscribe();
    };
  }, [open, handoffToSetup]);

  const finish = React.useCallback((status: 'skipped' | 'completed', restoreRoute = true) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    save({ status, step });
    if (account.current) { try { sessionStorage.setItem(dismissedKey(account.current), 'true'); } catch {} }
    const wasNavigating = routePending.current;
    expectedUrl.current = null;
    routePending.current = false;
    if (status === 'skipped' && restoreRoute && (wasNavigating || origin.current !== window.location.pathname + window.location.search + window.location.hash)) router.replace(origin.current, { scroll: false });
    if (status === 'completed') router.replace('/me', { scroll: false });
    requestAnimationFrame(() => {
      const target = returnFocus.current;
      const bounds = target?.getBoundingClientRect();
      const visible = target?.isConnected && target !== document.body && bounds && bounds.width > 0 && bounds.height > 0 && bounds.left < window.innerWidth && bounds.top < window.innerHeight && bounds.right > 0 && bounds.bottom > 0;
      if (visible && !target.closest('[aria-hidden="true"]')) target.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('[data-tour-help]')?.focus({ preventScroll: true });
    });
  }, [router, save, step]);

  React.useEffect(() => {
    if (!active || !expectedUrl.current) return;
    const currentUrl = window.location.pathname + window.location.search + window.location.hash;
    if (currentUrl === expectedUrl.current) { routePending.current = false; return; }
    // A browser Back/Forward or external navigation cancels the tour without undoing it.
    if (!routePending.current) finish('skipped', false);
  }, [pathname, active, finish]);
  React.useEffect(() => {
    if (!active) return;
    const onHistory = () => finish('skipped', false);
    window.addEventListener('popstate', onHistory);
    return () => window.removeEventListener('popstate', onHistory);
  }, [active, finish]);

  const move = (next: number) => {
    if (Date.now() < actionLock.current) return;
    actionLock.current = Date.now() + 300;
    if (next >= TOUR_STEPS.length) { finish('completed'); return; }
    const wasNavigating = routePending.current;
    const requestedRoute = TOUR_STEPS[next].route;
    const route = requestedRoute ? tourNavigationPath(requestedRoute, origin.current) : origin.current;
    expectedUrl.current = route;
    routePending.current = wasNavigating || route !== window.location.pathname + window.location.search + window.location.hash;
    setStep(next);
    save({ status: 'pending', step: next });
    if (routePending.current) router.replace(route, { scroll: false });
  };
  const replay = React.useCallback(() => {
    if (activeRef.current || setupBlocked.current) return;
    if (account.current) { try { sessionStorage.removeItem(dismissedKey(account.current)); } catch {} }
    open(0);
    save({ action: 'replay' }, 'POST');
  }, [open, save]);

  return (
    <Context.Provider value={{ active, step, replay }}>
      {children}
      {!active && saveWarning && <div role="status" style={{ position: 'fixed', bottom: 20, left: 16, right: 16, margin: '0 auto', maxWidth: 440, zIndex: 300, padding: '12px 16px', borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--sur)', boxShadow: '0 4px 24px rgba(0,0,0,.15)', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--f2)' }}>
        <span>가이드 진행 상태를 저장하지 못했어요. 다음 로그인 때 다시 안내될 수 있어요.</span>
        <button type="button" className="btn sm" onClick={() => setSaveWarning(false)} aria-label="저장 상태 알림 닫기">닫기</button>
      </div>}
      {active && <TourOverlay step={step} saveWarning={saveWarning} onNext={() => move(step + 1)} onBack={() => move(Math.max(0, step - 1))} onSkip={() => finish('skipped')} />}
    </Context.Provider>
  );
}
