'use client';
import { useEffect, useMemo } from 'react';
import RankingDailyInsights, { useRankingDailyInsights } from '@/components/ranking/RankingDailyInsights';
import { useRankingDailySession } from '@/components/ranking/RankingDailyProvider';
import { staffDailyPlanningScope, staffPlanningFilterFromParams, staffPlanningFilterToParams, DEFAULT_STAFF_FILTER, type StaffPlanningFilter } from '@/lib/staff-daily-planning';
import { useRouter, useSearchParams } from 'next/navigation';
import { CATEGORY_MAP, AGE_MAP } from '@/lib/queries';
import { FilterBlock, PillGroup } from '@/components/ui/filters';

/** Keep the subscriber above the responsive branch; tab exit invalidates its receipt. */
export function useStaffDailyPlanningCheck(date: string, today: string, active: boolean) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.toString();
  const filter = useMemo(() => staffPlanningFilterFromParams(new URLSearchParams(raw)), [raw]);
  const scope = useMemo(() => active && filter ? staffDailyPlanningScope(date, today, filter) : null, [date, today, active, filter]);
  const changeFilter = (next: StaffPlanningFilter) => {
    const params = staffPlanningFilterToParams(new URLSearchParams(raw), next);
    router.push(`/today?${params.toString()}`, { scroll: false });
  };
  const load = useRankingDailyInsights(scope);
  const session = useRankingDailySession();
  useEffect(() => { if (!scope) session?.clearScope(); }, [scope, session]);
  return { scope, load, filter, changeFilter, validDate: !!staffDailyPlanningScope(date, today) };
}

export default function StaffDailyPlanningCheck({ state, compact }: {
  state: ReturnType<typeof useStaffDailyPlanningCheck>; compact: boolean;
}) {
  if (!state.validDate) return null;
  const filter = state.filter ?? DEFAULT_STAFF_FILTER;
  return <div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
      <FilterBlock label="담당 카테고리">
        <select aria-label="담당 카테고리" className="input-date" value={filter.selectedCategory}
          onChange={e => state.changeFilter({ ...filter, selectedCategory: e.target.value })}>
          {Object.entries(CATEGORY_MAP).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </FilterBlock>
      <FilterBlock label="성별"><PillGroup value={filter.gender} onChange={gender => state.changeFilter({ ...filter, gender })}
        options={[["A", "전체"], ["M", "남성"], ["F", "여성"]]} /></FilterBlock>
      <FilterBlock label="연령"><PillGroup value={filter.age} onChange={age => state.changeFilter({ ...filter, age })}
        options={Object.entries(AGE_MAP)} /></FilterBlock>
    </div>
    {!state.filter && <p role="alert">URL의 담당 범위가 올바르지 않아 조회하지 않았습니다. 범위를 다시 선택하세요.</p>}
    <p className="dim" style={{ fontSize: 11, lineHeight: 1.6, margin: '0 0 8px' }}>
      브리핑 전일의 저장 관측 · 무신사 {CATEGORY_MAP[filter.selectedCategory]} · {filter.gender === 'A' ? '전체 성별' : filter.gender === 'M' ? '남성' : '여성'} · {AGE_MAP[filter.age]} 연령.
      AI 브리핑 생성 여부와 별개로 확인할 자료이며, 판매량·수요 증가나 순위 상승 원인의 증거가 아닙니다.
    </p>
    <RankingDailyInsights scope={state.scope} load={state.load} compact={compact} heading="오늘 영업기획 확인" />
  </div>;
}
