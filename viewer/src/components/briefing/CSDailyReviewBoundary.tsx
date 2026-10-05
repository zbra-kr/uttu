'use client';
import { Suspense, useCallback, useLayoutEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCSDailyReviewCheck, type CSDailyReviewState } from '@/hooks/useCSDailyReviewCheck';
import { CSDailyReviewContext } from '@/lib/cs-daily-review-context';
import { useKstToday } from '@/hooks/useKstToday';

function Scope({ onChange }: { onChange: (state: CSDailyReviewState) => void }) {
  const params = useSearchParams();
  const today = useKstToday();
  const state = useCSDailyReviewCheck(params.get('tab') === 'cs', params.get('date') ?? today, today);
  // Publish before paint, so an identity change cannot display the prior owner's text.
  useLayoutEffect(() => { onChange(state); }, [state, onChange]);
  return null;
}

/** One route-owned reader above Shell's responsive reparenting; never persisted. */
export default function CSDailyReviewBoundary({ active, children }: { active: boolean; children: ReactNode }) {
  const [owner, setOwner] = useState<{ active: boolean; epoch: number; state: CSDailyReviewState | null }>({ active, epoch: 0, state: null });
  if (owner.active !== active) setOwner({ active, epoch: owner.epoch + 1, state: null });
  const publish = useCallback((state: CSDailyReviewState) => {
    setOwner(current => current.active && current.epoch === owner.epoch && current.state !== state ? { ...current, state } : current);
  }, [owner.epoch]);
  return <CSDailyReviewContext.Provider value={active && owner.active ? owner.state : null}>
    {children}
    <Suspense fallback={null}>{active && <Scope key={owner.epoch} onChange={publish} />}</Suspense>
  </CSDailyReviewContext.Provider>;
}
