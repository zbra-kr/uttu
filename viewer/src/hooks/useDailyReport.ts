'use client';
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchDailyReport, type DailyReportData } from '@/lib/queries-report';
import { fetchReportBrandEvidence, type BrandEvidence } from '@/lib/report-brand-evidence';

type State<T> = { state: 'loading' | 'signedout' | 'error' | 'ready'; data: T | null };
const pending = { state: 'loading', data: null } as const;
export function useDailyReport() {
  const [core, setCore] = useState<State<DailyReportData>>(pending);
  const [brand, setBrand] = useState<State<BrandEvidence>>(pending);
  const generation = useRef(0);
  useEffect(() => {
    let disposed = false, eventSeen = false, current: string | null | undefined;
    let controller: AbortController | undefined;
    const identity = (id: string | null) => {
      if (disposed || current === id) return;
      current = id; controller?.abort(); const epoch = ++generation.current;
      setCore(id ? pending : { state: 'signedout', data: null });
      setBrand(id ? pending : { state: 'signedout', data: null });
      if (!id) return;
      controller = new AbortController(); const signal = controller.signal;
      const active = () => !disposed && !signal.aborted && generation.current === epoch;
      void fetchDailyReport(signal).then(data => { if (active()) setCore({ state: 'ready', data }); })
        .catch(() => { if (active()) setCore({ state: 'error', data: null }); });
      void fetchReportBrandEvidence(signal).then(data => { if (active()) setBrand({ state: 'ready', data }); })
        .catch(() => { if (active()) setBrand({ state: 'error', data: null }); });
    };
    const client = supabaseBrowser();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true; identity(session?.user?.id ?? null);
    });
    const authFailed = () => {
      if (disposed || eventSeen) return;
      setCore({ state: 'error', data: null }); setBrand({ state: 'error', data: null });
    };
    void client.auth.getUser().then(({ data, error }) => {
      if (disposed || eventSeen) return;
      if (error) authFailed(); else identity(data.user?.id ?? null);
    }).catch(authFailed);
    return () => { disposed = true; controller?.abort(); subscription.unsubscribe(); };
  }, []);
  const rows = brand.state === 'ready' ? brand.data?.rows ?? [] : [];
  const data = core.data ? { ...core.data, brandRanking: rows, ownBrands: core.data.ownBrands.map(item => {
    const rank = rows.find(row => row.brandName === item.brandName);
    return { ...item, brandRank: rank?.rank ?? null, brandRankChange: rank?.rankChange ?? null };
  }) } : null;
  return { core, brand, data };
}
