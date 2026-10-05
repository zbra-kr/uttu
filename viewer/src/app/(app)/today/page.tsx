'use client';
import { Suspense, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchAllBriefings, fetchAvailableBriefingDates } from '@/lib/queries-briefing';
import { fetchBriefingKpiData } from '@/lib/queries-kpi';
import { useBriefingScope, useBriefingRead } from '@/hooks/useBriefingRead';
import { useKstToday } from '@/hooks/useKstToday';
import BriefingReadStatus from '@/components/briefing/BriefingReadStatus';
import BriefingTabs from '@/components/briefing/BriefingTabs';
import ExecutiveBriefingView from '@/components/briefing/ExecutiveBriefingView';
import StaffBriefingView from '@/components/briefing/StaffBriefingView';
import CSBriefingView from '@/components/briefing/CSBriefingView';
import MobileTodayView from '@/components/briefing/mobile/MobileTodayView';
import { useIsMobile } from '@/hooks/useViewport';
import { useCSDailyReviewState } from '@/lib/cs-daily-review-context';
import CSDailyReviewCheck from '@/components/briefing/CSDailyReviewCheck';
import { csReviewDate, validCSDate } from '@/lib/cs-daily-review-check';

type Tab = 'executive' | 'staff' | 'cs';
const VALID_TABS: Tab[] = ['executive', 'staff', 'cs'];

function EmptyState({ date }: { date: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '60px 20px', gap: 12, color: 'var(--f3)',
    }}>
      <span style={{ fontSize: 32 }}>📭</span>
      <p style={{ margin: 0, fontSize: 14 }}>{date} 브리핑이 아직 생성되지 않았습니다.</p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>매일 06:00 자동 생성됩니다.</p>
    </div>
  );
}

function FutureEmptyState({ date }: { date: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '60px 20px', gap: 12, color: 'var(--f3)',
    }}>
      <span style={{ fontSize: 32 }}>🔮</span>
      <p style={{ margin: 0, fontSize: 14 }}>{date}은(는) 미래 날짜입니다.</p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>미래 날짜의 브리핑은 조회할 수 없습니다.</p>
    </div>
  );
}

function TodayContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  const rawTab = searchParams.get('tab') as Tab | null;
  const activeTab: Tab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'executive';

  const today = useKstToday();
  const rawDate = searchParams.get('date');
  const activeDate = activeTab === 'cs' ? rawDate ?? today
    : (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) ? rawDate : today;
  const validDate = validCSDate(activeDate);
  const isFuture = validDate && activeDate > today;
  const ownedReviews = useCSDailyReviewState();
  const reviewDate = csReviewDate(activeDate, today);
  const csReviews = ownedReviews?.briefingDate === activeDate && ownedReviews.reviewDate === reviewDate && ownedReviews.status !== 'inactive' ? ownedReviews
    : { status: !reviewDate ? 'invalid-date' as const : 'loading' as const, scope: activeDate,
      briefingDate: activeDate, reviewDate, result: null, retry: () => {} };

  const scope = useBriefingScope(JSON.stringify(['today', activeDate, activeTab]));
  const readBriefing = useCallback((signal: AbortSignal) => fetchAllBriefings(activeDate, signal), [activeDate]);
  const readKpi = useCallback((signal: AbortSignal) => fetchBriefingKpiData(activeDate, signal), [activeDate]);
  const readDates = useCallback((signal: AbortSignal) => fetchAvailableBriefingDates(signal), []);
  const briefing = useBriefingRead(scope, readBriefing, validDate && !isFuture);
  const kpi = useBriefingRead(scope, readKpi, validDate && !isFuture && activeTab !== 'cs');
  const dateOptionsScope = useBriefingScope('today-date-options');
  const dates = useBriefingRead(dateOptionsScope, readDates);
  const optionsDay = useRef(today);
  useEffect(() => {
    if (optionsDay.current === today) return;
    optionsDay.current = today;
    void dates.retry();
  }, [today, dates.retry]);
  const data = briefing.value, availableDates = dates.value ?? [], kpiData = kpi.value;
  const readStatus = <>
    {validDate && !isFuture && <BriefingReadStatus state={briefing} label="브리핑" date={activeDate} />}
    {activeTab !== 'cs' && validDate && !isFuture && <BriefingReadStatus state={kpi} label="참고 지표" date={activeDate} />}
    <BriefingReadStatus state={dates} label="날짜 목록" retainedLabel="같은 로그인 상태에서 이전에 조회한 날짜 목록" />
  </>;

  function handleTabSelect(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.push(`/today?${params.toString()}`, { scroll: false });
  }

  function handleDateChange(date: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', date);
    router.push(`/today?${params.toString()}`, { scroll: false });
  }

  /* ── 모바일 뷰 ── */
  if (isMobile) {
    return (
      <MobileTodayView
        activeTab={activeTab}
        onTabSelect={handleTabSelect}
        data={data}
        kpiData={kpiData}
        loading={briefing.loading && !briefing.loaded}
        unavailable={!briefing.loaded}
        readStatus={readStatus}
        activeDate={activeDate}
        availableDates={availableDates}
        isFuture={isFuture}
        onDateChange={handleDateChange}
        csReviews={csReviews}
        invalidDate={!validDate}
      />
    );
  }

  /* ── 데스크탑 뷰 (변경 없음) ── */
  const activeBriefing = data ? data[activeTab] : null;

  // Full-height layout: BriefingTabs is a static header, content scrolls in its own container.
  // This avoids the z-index stacking issues that come with position:sticky inside a flex scroll container.
  return (
    <div style={{
      margin: '-18px -22px -30px',
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <BriefingTabs
        active={activeTab}
        currentDate={activeDate}
        availableDates={availableDates}
        executive={data?.executive ?? null}
        staff={data?.staff ?? null}
        cs={data?.cs ?? null}
        onSelect={handleTabSelect}
      />

      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '14px 22px 30px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>
        {activeTab === 'cs' && <CSDailyReviewCheck state={csReviews} />}
        {readStatus}
        {!validDate ? <p role="status">유효한 브리핑 날짜를 선택하세요.</p> : briefing.loading && !briefing.loaded ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 20px', color: 'var(--f4)', fontSize: 13 }}>
            불러오는 중...
          </div>
        ) : isFuture ? (
          <FutureEmptyState date={activeDate} />
        ) : !briefing.loaded ? null : activeBriefing === null ? (
          <EmptyState date={data?.briefing_date ?? activeDate} />
        ) : activeTab === 'executive' ? (
          <ExecutiveBriefingView briefing={activeBriefing} kpiData={kpiData} />
        ) : activeTab === 'staff' ? (
          <StaffBriefingView briefing={activeBriefing} kpiData={kpiData} />
        ) : (
          <CSBriefingView briefing={activeBriefing} />
        )}
      </div>
    </div>
  );
}

export default function TodayPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 20px', color: 'var(--f4)', fontSize: 13 }}>
        불러오는 중...
      </div>
    }>
      <TodayContent />
    </Suspense>
  );
}
