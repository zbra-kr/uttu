'use client';
import { useEffect, useState } from 'react';
import { realCalendarDate } from '@/lib/briefing-anomaly-date';
import { kstToday } from '@/lib/format';

type Scope = { token: string | null; period: string; fromDate: string; toDate: string };
function daysAgo(days: number): string {
  const date = new Date(`${kstToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
function initial(token: string | null, defaultPeriod: string): Scope {
  const date = realCalendarDate(token);
  return { token, period: date ? 'custom' : defaultPeriod,
    fromDate: date ?? daysAgo(6), toDate: date ?? kstToday() };
}

/** URL date changes apply during render, before effects or a previous query can paint. */
export function useAnomalyDateScope(token: string | null, defaultPeriod = 'today') {
  const [stored, setStored] = useState(() => initial(token, defaultPeriod));
  const active = stored.token === token ? stored : initial(token, defaultPeriod);
  useEffect(() => { setStored(initial(token, defaultPeriod)); }, [token, defaultPeriod]);
  const update = (patch: Partial<Scope>) => setStored(previous => ({
    ...(previous.token === token ? previous : initial(token, defaultPeriod)), ...patch,
  }));
  const { period, fromDate, toDate } = active;
  const today = kstToday();
  const from = period === 'today' ? today : period === '7d' ? daysAgo(6)
    : period === '30d' ? daysAgo(29) : period === '90d' ? daysAgo(89) : fromDate;
  const to = period === 'custom' ? toDate : today;
  return { period, fromDate, toDate, from, to,
    setPeriod: (value: string) => update({ period: value }),
    setFromDate: (value: string) => update({ fromDate: value }),
    setToDate: (value: string) => update({ toDate: value }) };
}
