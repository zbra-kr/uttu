'use client';
import { Suspense, useCallback, useLayoutEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { kstToday } from '@/lib/format';
import { useObservationReviews } from '@/hooks/useObservationReviews';
import { ObservationReviewContext } from '@/lib/observation-review-context';
type State = ReturnType<typeof useObservationReviews>;
function Scope({ publish }: { publish: (state: State) => void }) {
  const state = useObservationReviews(useSearchParams().toString(), kstToday());
  useLayoutEffect(() => { publish(state); }, [state, publish]); return null;
}
/** Route ownership survives Shell's responsive reparenting; no persisted results. */
export default function ObservationReviewBoundary({ active, children }: { active: boolean; children: ReactNode }) {
  const [owner, setOwner] = useState<{ active: boolean; epoch: number; state: State | null }>({ active, epoch: 0, state: null });
  if (owner.active !== active) setOwner({ active, epoch: owner.epoch + 1, state: null });
  const publish = useCallback((state: State) => setOwner(current => current.active && current.epoch === owner.epoch && current.state !== state ? { ...current, state } : current), [owner.epoch]);
  return <ObservationReviewContext.Provider value={active && owner.active ? owner.state : null}>
    {children}<Suspense fallback={null}>{active && <Scope key={owner.epoch} publish={publish} />}</Suspense>
  </ObservationReviewContext.Provider>;
}
