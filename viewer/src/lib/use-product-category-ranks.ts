'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { fetchProductCategoryRanks, type CategoryRanksResult } from '@/lib/queries';
import { supabaseBrowser } from '@/lib/supabase/client';

type Snapshot = { status: 'loading' | 'ready' | 'error' | 'signedout'; data: CategoryRanksResult | null };
const loading: Snapshot = { status: 'loading', data: null };
const signedout: Snapshot = { status: 'signedout', data: null };

// Share only while mounted, across responsive views. No account data survives teardown.
export function createCategoryRanksStore(client: ReturnType<typeof supabaseBrowser>, read = fetchProductCategoryRanks) {
  type Entry = { snapshot: Snapshot; listeners: Set<() => void>; controller?: AbortController; timer?: ReturnType<typeof setTimeout> };
  const entries = new Map<string, Entry>();
  let userId: string | null = null, authReady = false, generation = 0;
  let subscription: { unsubscribe(): void } | undefined;
  const notify = (entry: Entry) => entry.listeners.forEach(listener => listener());
  const cancel = (entry: Entry) => { entry.controller?.abort(); clearTimeout(entry.timer); };
  const startRead = (no: string, entry: Entry) => {
    cancel(entry);
    entry.snapshot = authReady && !userId ? signedout : loading;
    notify(entry);
    if (!authReady || !userId || !no) return;
    const controller = new AbortController();
    entry.controller = controller;
    const current = () => !controller.signal.aborted && entries.get(no) === entry && entry.controller === controller;
    entry.timer = setTimeout(() => {
      if (!current()) return;
      controller.abort();
      entry.snapshot = { status: 'error', data: null }; notify(entry);
    }, 15000);
    void read(no, controller.signal).then(data => {
      if (current()) { clearTimeout(entry.timer); entry.snapshot = { status: 'ready', data }; notify(entry); }
    }).catch(() => {
      if (current()) { clearTimeout(entry.timer); entry.snapshot = { status: 'error', data: null }; notify(entry); }
    });
  };
  const startAuth = () => {
    const epoch = ++generation;
    let eventSeen = false;
    const identity = (id: string | null) => {
      if (generation !== epoch || (authReady && id === userId)) return;
      authReady = true; userId = id;
      entries.forEach((entry, no) => startRead(no, entry));
    };
    subscription = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true; identity(session?.user?.id ?? null);
    }).data.subscription;
    void client.auth.getUser().then(({ data, error }) => {
      if (!eventSeen) identity(error ? null : data.user?.id ?? null);
    }).catch(() => { if (!eventSeen) identity(null); });
  };
  return {
    getSnapshot: (no: string): Snapshot => entries.get(no)?.snapshot ?? loading,
    subscribe(no: string, listener: () => void) {
      let entry = entries.get(no);
      if (!entry) {
        entry = { snapshot: loading, listeners: new Set() }; entries.set(no, entry);
        if (authReady) startRead(no, entry);
      }
      entry.listeners.add(listener);
      if (!subscription) startAuth();
      const owned = entry;
      return () => {
        owned.listeners.delete(listener);
        if (!owned.listeners.size) { cancel(owned); entries.delete(no); }
        if (!entries.size) { subscription?.unsubscribe(); subscription = undefined; generation++; authReady = false; userId = null; }
      };
    },
    retry(no: string) { const entry = entries.get(no); if (entry && entry.snapshot.status !== 'loading') startRead(no, entry); },
  };
}
let shared: ReturnType<typeof createCategoryRanksStore> | undefined;
export function useProductCategoryRanks(no: string) {
  const store = shared ??= createCategoryRanksStore(supabaseBrowser());
  const subscribe = useCallback((listener: () => void) => store.subscribe(no, listener), [store, no]);
  const snapshot = useSyncExternalStore(subscribe, () => store.getSnapshot(no), () => loading);
  return { ...snapshot, retry: () => store.retry(no) };
}
