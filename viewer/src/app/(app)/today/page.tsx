'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchAllBriefings, fetchAvailableBriefingDates, kstToday, AllBriefings } from '@/lib/queries-briefing';
import { fetchBriefingKpiData, BriefingKpiData } from '@/lib/queries-kpi';
import BriefingTabs from '@/components/briefing/BriefingTabs';
import ExecutiveBriefingView from '@/components/briefing/ExecutiveBriefingView';
import StaffBriefingView from '@/components/briefing/StaffBriefingView';
import CSBriefingView from '@/components/briefing/CSBriefingView';

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

  const rawTab = searchParams.get('tab') as Tab | null;
  const activeTab: Tab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'executive';

  const today = kstToday();
  const rawDate = searchParams.get('date');
  const activeDate = (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) ? rawDate : today;
  const isFuture = activeDate > today;

  const [data, setData] = useState<AllBriefings | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [kpiData, setKpiData] = useState<BriefingKpiData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAvailableBriefingDates().then(setAvailableDates);
  }, []);

  useEffect(() => {
    setLoading(true);
    setKpiData(null);
    Promise.all([
      fetchAllBriefings(activeDate),
      isFuture ? Promise.resolve(null) : fetchBriefingKpiData(activeDate),
    ]).then(([result, kpi]) => {
      setData(result);
      setKpiData(kpi);
      setLoading(false);
    });
  }, [activeDate, isFuture]);

  function handleTabSelect(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.push(`/today?${params.toString()}`, { scroll: false });
  }

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
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 20px', color: 'var(--f4)', fontSize: 13 }}>
            불러오는 중...
          </div>
        ) : isFuture ? (
          <FutureEmptyState date={activeDate} />
        ) : activeBriefing === null ? (
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
