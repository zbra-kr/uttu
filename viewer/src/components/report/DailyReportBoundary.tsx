'use client';
import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { ReportOwnerContext, type DailyReportSnapshot } from '@/lib/report-owner-context';

const Owner = lazy(() => import('./DailyReportScope'));

/** Stable Shell ancestry. Only the sibling data owner is route-specific and lazy. */
export default function DailyReportBoundary({ active, children }: { active: boolean; children: ReactNode }) {
  const [scope, setScope] = useState<{ active: boolean; epoch: number; report: DailyReportSnapshot | null }>({ active, epoch: 0, report: null });
  if (scope.active !== active) setScope({ active, epoch: scope.epoch + 1, report: null });
  const publish = useCallback((report: DailyReportSnapshot) => {
    setScope(current => current.active && current.epoch === scope.epoch ? { ...current, report } : current);
  }, [scope.epoch]);
  const value = useMemo(() => ({ managed: true, active, report: active && scope.active ? scope.report : null }), [active, scope.active, scope.report]);
  return <ReportOwnerContext.Provider value={value}>
    {children}
    <Suspense fallback={null}>{active && <Owner key={scope.epoch} onChange={publish} />}</Suspense>
  </ReportOwnerContext.Provider>;
}
