'use client';
import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchDailyReport, type DailyReportData } from '@/lib/queries-report';
import { fetchReportBrandEvidence, type BrandEvidence } from '@/lib/report-brand-evidence';
import { fetchReportPromotionHeaders, fetchReportPromotionItems, derivePromotionEvidence, applyPromotionEvidence,
  type PromotionHeaders, type PromotionItems } from '@/lib/report-promotion-evidence';
import { fetchReportRecommendModules, fetchReportRecommendItems, deriveRecommendEvidence, applyRecommendEvidence,
  type RecommendModules, type RecommendItems } from '@/lib/report-recommend-evidence';

type State<T> = { state: 'loading' | 'signedout' | 'error' | 'ready'; data: T | null };
const pending = { state: 'loading', data: null } as const;
export function useDailyReportLoader(enabled = true, revision = 0) {
  const [core, setCore] = useState<State<DailyReportData>>(pending);
  const [brand, setBrand] = useState<State<BrandEvidence>>(pending);
  const [headers, setHeaders] = useState<State<PromotionHeaders>>(pending);
  const [items, setItems] = useState<State<PromotionItems>>(pending);
  const [recommendModulesSource, setModules] = useState<State<RecommendModules>>(pending);
  const [recommendItemsSource, setRecommendItems] = useState<State<RecommendItems>>(pending);
  const generation = useRef(0);
  const retryRef = useRef<(() => void) | null>(null);
  const retryBrand = useCallback(() => retryRef.current?.(), []);
  const headerRetryRef = useRef<(() => void) | null>(null), itemRetryRef = useRef<(() => void) | null>(null);
  const retryHeaders = useCallback(() => headerRetryRef.current?.(), []);
  const retryItems = useCallback(() => itemRetryRef.current?.(), []);
  const moduleRetryRef = useRef<(() => void) | null>(null), recommendItemRetryRef = useRef<(() => void) | null>(null);
  const retryRecommendModules = useCallback(() => moduleRetryRef.current?.(), []);
  const retryRecommendItems = useCallback(() => recommendItemRetryRef.current?.(), []);
  // A route re-entry or expired responsive reuse starts without the prior snapshot.
  const [scope, setScope] = useState({ enabled, revision });
  if (scope.enabled !== enabled || scope.revision !== revision) {
    setScope({ enabled, revision });
    setCore(pending); setBrand(pending); setHeaders(pending); setItems(pending);
    setModules(pending); setRecommendItems(pending);
  }
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, eventSeen = false, current: string | null | undefined;
    let controller: AbortController | undefined, brandController: AbortController | undefined;
    let brandAttempt = 0, brandPending = false, authAttempt = 0, authPending = false;
    const sourceControllers = new Set<AbortController>();
    const abortSources = () => { sourceControllers.forEach(c => c.abort()); sourceControllers.clear(); };
    const identity = (id: string | null) => {
      if (disposed || current === id) return;
      current = id; controller?.abort(); brandController?.abort(); retryRef.current = null;
      abortSources(); headerRetryRef.current = null; itemRetryRef.current = null;
      moduleRetryRef.current = null; recommendItemRetryRef.current = null;
      const epoch = ++generation.current;
      setCore(id ? pending : { state: 'signedout', data: null });
      setBrand(id ? pending : { state: 'signedout', data: null });
      setHeaders(id ? pending : { state: 'signedout', data: null });
      setItems(id ? pending : { state: 'signedout', data: null });
      setModules(id ? pending : { state: 'signedout', data: null });
      setRecommendItems(id ? pending : { state: 'signedout', data: null });
      if (!id) return;
      controller = new AbortController(); const signal = controller.signal;
      const active = () => !disposed && !signal.aborted && generation.current === epoch;
      void fetchDailyReport(signal).then(data => { if (active()) setCore({ state: 'ready', data }); })
        .catch(() => { if (active()) setCore({ state: 'error', data: null }); });
      const readBrand = () => {
        if (!active() || brandPending) return;
        brandPending = true; brandController?.abort();
        brandController = new AbortController(); const sourceSignal = brandController.signal;
        const attempt = ++brandAttempt;
        const sourceActive = () => active() && !sourceSignal.aborted && attempt === brandAttempt;
        setBrand(pending);
        void fetchReportBrandEvidence(sourceSignal).then(data => {
          if (sourceActive()) { brandPending = false; setBrand({ state: 'ready', data }); }
        }).catch(() => {
          if (sourceActive()) { brandPending = false; setBrand({ state: 'error', data: null }); }
        });
      };
      brandPending = false; retryRef.current = readBrand; readBrand();
      const attachSource = <T,>(read: (signal: AbortSignal) => Promise<T>, set: (value: State<T>) => void) => {
        let inFlight = false;
        return () => {
          if (!active() || inFlight) return;
          inFlight = true;
          const sourceController = new AbortController(); sourceControllers.add(sourceController);
          const sourceActive = () => active() && !sourceController.signal.aborted;
          set(pending);
          void read(sourceController.signal).then(data => { if (sourceActive()) set({ state: 'ready', data }); })
            .catch(() => { if (sourceActive()) set({ state: 'error', data: null }); })
            .finally(() => { inFlight = false; sourceControllers.delete(sourceController); });
        };
      };
      headerRetryRef.current = attachSource(fetchReportPromotionHeaders, setHeaders);
      itemRetryRef.current = attachSource(fetchReportPromotionItems, setItems);
      headerRetryRef.current(); itemRetryRef.current();
      moduleRetryRef.current = attachSource(fetchReportRecommendModules, setModules);
      recommendItemRetryRef.current = attachSource(fetchReportRecommendItems, setRecommendItems);
      moduleRetryRef.current(); recommendItemRetryRef.current();
    };
    const client = supabaseBrowser();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true; identity(session?.user?.id ?? null);
    });
    const authFailed = () => {
      if (disposed || eventSeen) return;
      authPending = false;
      retryRef.current = lookupIdentity;
      headerRetryRef.current = lookupIdentity; itemRetryRef.current = lookupIdentity;
      moduleRetryRef.current = lookupIdentity; recommendItemRetryRef.current = lookupIdentity;
      setCore({ state: 'error', data: null }); setBrand({ state: 'error', data: null });
      setHeaders({ state: 'error', data: null }); setItems({ state: 'error', data: null });
      setModules({ state: 'error', data: null }); setRecommendItems({ state: 'error', data: null });
    };
    const lookupIdentity = () => {
      if (disposed || eventSeen || authPending) return;
      authPending = true; const attempt = ++authAttempt;
      setCore(pending); setBrand(pending);
      setHeaders(pending); setItems(pending);
      setModules(pending); setRecommendItems(pending);
      void client.auth.getUser().then(({ data, error }) => {
        if (disposed || eventSeen || attempt !== authAttempt) return;
        authPending = false;
        if (error) authFailed(); else identity(data.user?.id ?? null);
      }).catch(() => { if (attempt === authAttempt) authFailed(); });
    };
    lookupIdentity();
    return () => { disposed = true; controller?.abort(); brandController?.abort(); abortSources(); retryRef.current = null;
      headerRetryRef.current = null; itemRetryRef.current = null;
      moduleRetryRef.current = null; recommendItemRetryRef.current = null; subscription.unsubscribe(); };
  }, [enabled, revision]);
  const rows = brand.state === 'ready' ? brand.data?.rows ?? [] : [];
  const promotion = derivePromotionEvidence(headers, items);
  const recommend = deriveRecommendEvidence(recommendModulesSource, recommendItemsSource);
  const merged = core.data ? applyPromotionEvidence(applyRecommendEvidence(core.data, recommend), promotion) : null;
  const data = merged ? { ...merged, brandRanking: rows, ownBrands: merged.ownBrands.map(item => {
    const rank = brand.state === 'ready' ? brand.data?.latestRows.find(row => row.brandName === item.brandName) : undefined;
    return { ...item, brandRank: rank?.rank ?? null, brandRankChange: rank?.rankChange ?? null };
  }) } : null;
  return { core, brand, headers, items, promotion, recommendModulesSource, recommendItemsSource, recommend,
    data, retryBrand, retryHeaders, retryItems, retryRecommendModules, retryRecommendItems };
}

export const DailyReportContext = createContext<ReturnType<typeof useDailyReportLoader> | null>(null);

export function useDailyReport() {
  const shared = useContext(DailyReportContext);
  const local = useDailyReportLoader(shared === null);
  return shared ?? local;
}
