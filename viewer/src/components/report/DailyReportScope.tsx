'use client';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDailyReportLoader } from '@/hooks/useDailyReport';
import type { DailyReportSnapshot } from '@/lib/report-owner-context';

export const REPORT_RESPONSIVE_FRESHNESS_MS = 60_000;

/** A lazy sibling of Shell; publishes before paint and unmounts on route exit. */
export default memo(function DailyReportScope({ onChange }: { onChange: (report: DailyReportSnapshot) => void }) {
  const active = true;
  const [revision, setRevision] = useState(0);
  const report = useDailyReportLoader(active, revision);
  const settledAt = useRef<number | null>(null);
  const states = [report.core, report.brand, report.headers, report.items,
    report.recommendModulesSource, report.recommendItemsSource];
  const settled = active && states.every(source => source.state === 'ready' || source.state === 'error');
  const current = useRef({ settled, active });
  current.current = { settled, active };
  const coreSnapshot = useRef(report.core.data);
  if (!active || coreSnapshot.current !== report.core.data) {
    coreSnapshot.current = report.core.data;
    settledAt.current = null;
  }
  // Retrying one source must not extend the freshness of the other settled sources.
  if (settled && settledAt.current === null) settledAt.current = Date.now();

  useEffect(() => {
    if (!active) return;
    const media = window.matchMedia('(max-width: 767px)');
    const transition = () => {
      // Pending work survives any resize. Never extend settled reuse past this bound.
      if (current.current.active && current.current.settled && settledAt.current !== null &&
          Date.now() - settledAt.current >= REPORT_RESPONSIVE_FRESHNESS_MS) {
        settledAt.current = null;
        setRevision(value => value + 1);
      }
    };
    media.addEventListener('change', transition);
    return () => media.removeEventListener('change', transition);
  }, [active]);

  useLayoutEffect(() => { onChange(report); }, [onChange, report]);
  return null;
});
