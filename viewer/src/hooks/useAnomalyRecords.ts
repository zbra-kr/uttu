'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

export interface AnomalyRecord {
  id: string; detected_at: string; detection_date: string; module: string;
  severity: string; anomaly_type: string; entity_type: string | null;
  entity_id: string | null; entity_name: string | null; description: string | null;
  meta: Record<string, unknown> | null;
}
const PAGE_SIZE = 100;
const FIELDS = 'id, detected_at, detection_date, module, severity, anomaly_type, entity_type, entity_id, entity_name, description, meta';
type Cursor = { detected_at: string; id: string };
function cursorFilter(cursor: Cursor) {
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.detected_at)
      || !/^[0-9a-f-]{36}$/i.test(cursor.id)) throw new Error('페이지 위치를 확인할 수 없습니다.');
  return `detected_at.lt.${cursor.detected_at},and(detected_at.eq.${cursor.detected_at},id.lt.${cursor.id})`;
}

export function useAnomalyRecords(from: string, to: string) {
  const [identity, setIdentity] = useState<string | null>(null);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [authResolved, setAuthResolved] = useState(false);
  const [loadedScope, setLoadedScope] = useState('');
  const [rows, setRows] = useState<AnomalyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const cursor = useRef<Cursor | null>(null);
  const request = useRef<AbortController | null>(null);
  const scope = `${identity ?? ''}|${authEpoch}|${from}|${to}`;
  const activeScope = useRef(scope);
  const observedIdentity = useRef<string | null | undefined>(undefined);
  activeScope.current = scope;

  useEffect(() => {
    const client = supabaseBrowser();
    let active = true;
    let authChanged = false;
    const change = (id: string | null) => {
      if (observedIdentity.current === id) return;
      observedIdentity.current = id;
      generation.current++;
      request.current?.abort();
      busy.current = false; cursor.current = null;
      setRows([]); setHasMore(false); setError(null); setIdentity(id); setAuthEpoch(value => value + 1);
      setAuthResolved(true);
    };
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      authChanged = true; change(session?.user.id ?? null);
    });
    client.auth.getUser().then(({ data: user, error: authError }) => {
      if (active && !authChanged) change(authError ? null : user.user?.id ?? null);
    }).catch(() => { if (active && !authChanged) change(null); });
    return () => { active = false; data.subscription.unsubscribe(); request.current?.abort(); generation.current++; };
  }, []);

  const load = useCallback(async (append = false) => {
    if (!identity || busy.current) return;
    const ownScope = scope;
    const ownGeneration = generation.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    request.current = controller; busy.current = true;
    setLoading(true); setError(null);
    try {
      let query = supabaseBrowser().from('anomalies').select(FIELDS)
        .gte('detection_date', from).lte('detection_date', to)
        .order('detected_at', { ascending: false }).order('id', { ascending: false })
        .limit(PAGE_SIZE + 1).abortSignal(controller.signal);
      if (append && cursor.current) query = query.or(cursorFilter(cursor.current));
      const result = await query;
      if (activeScope.current !== ownScope || generation.current !== ownGeneration) return;
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) throw new Error('조회 결과를 확인할 수 없습니다.');
      const page = result.data.slice(0, PAGE_SIZE) as AnomalyRecord[];
      cursor.current = page.length ? page[page.length - 1] : cursor.current;
      setRows(previous => {
        const unique = new Map((append ? previous : []).map(row => [row.id, row]));
        for (const row of page) unique.set(row.id, row);
        return [...unique.values()];
      });
      setHasMore(result.data.length > PAGE_SIZE);
      setLoadedScope(ownScope);
    } catch (e) {
      if (activeScope.current === ownScope && generation.current === ownGeneration)
        setError(e instanceof Error ? e.message : '데이터 조회 실패');
    } finally {
      clearTimeout(timeout);
      if (activeScope.current === ownScope && generation.current === ownGeneration) {
        busy.current = false; setLoading(false);
      }
    }
  }, [from, to, identity, scope]);

  useEffect(() => {
    generation.current++; request.current?.abort(); busy.current = false; cursor.current = null;
    setRows([]); setHasMore(false); setError(null);
    if (identity) void load(); else setLoading(!authResolved);
    return () => { generation.current++; request.current?.abort(); busy.current = false; };
  }, [load, identity, authResolved]);
  return { rows: loadedScope === scope ? rows : [], loading,
    error: authResolved && !identity ? '로그인 상태를 확인해주세요.' : error,
    hasMore: loadedScope === scope && hasMore, identity, identityKey: `${identity ?? ''}|${authEpoch}`,
    loadMore: () => load(true), retry: () => load(cursor.current !== null) };
}
