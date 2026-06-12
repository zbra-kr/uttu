'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import BriefingCalendarPopover from './BriefingCalendarPopover';
import { kstToday } from '@/lib/queries-briefing';

interface Props {
  currentDate: string;
  activeTab: string;
  availableDates: string[];
}

const KO_DAY = ['일', '월', '화', '수', '목', '금', '토'];

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateKo(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = KO_DAY[new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 (${dow})`;
}

function formatShort(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  const dow = KO_DAY[new Date(dateStr.slice(0, 4) as unknown as number, m - 1, d).getDay()];
  return `${m}/${d} (${dow})`;
}

function formatShortSafe(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  const [y, m, d] = parts;
  const dow = KO_DAY[new Date(y, m - 1, d).getDay()];
  return `${m}/${d} (${dow})`;
}

export default function BriefingDateNav({ currentDate, activeTab, availableDates }: Props) {
  const router = useRouter();
  const [calOpen, setCalOpen] = useState(false);

  const today = kstToday();
  const isToday = currentDate === today;
  const yesterday = addDays(currentDate, -1);
  const tomorrow = addDays(currentDate, 1);
  const tomorrowDisabled = tomorrow > today;

  function navigate(date: string) {
    const params = new URLSearchParams();
    if (date !== today) params.set('date', date);
    if (activeTab !== 'executive') params.set('tab', activeTab);
    const qs = params.toString();
    router.push(`/today${qs ? '?' + qs : ''}`, { scroll: false });
  }

  const btnBase: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    padding: '4px 8px',
    borderRadius: 5,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '8px 16px',
      borderBottom: '0.5px solid var(--bs)',
      gap: 8,
    }}>
      {/* ← 어제 */}
      <button
        style={{ ...btnBase, color: 'var(--f3)', minWidth: 110, justifyContent: 'flex-start' }}
        onClick={() => navigate(yesterday)}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--f1)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--f3)'; }}
      >
        ← {formatShortSafe(yesterday)}
      </button>

      {/* 중앙: 날짜 라벨 + 달력 팝오버 */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <button
          style={{
            ...btnBase,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'var(--mono)',
            color: 'var(--f1)',
            padding: '4px 12px',
            border: '0.5px solid var(--bs)',
            borderRadius: 7,
            gap: 6,
          }}
          onClick={() => setCalOpen(o => !o)}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--snk)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
        >
          <span style={{ fontSize: 13 }}>📅</span>
          {formatDateKo(currentDate)}
          <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--sans)' }}>▾</span>
        </button>

        {calOpen && (
          <BriefingCalendarPopover
            currentDate={currentDate}
            availableDates={availableDates}
            onSelect={(d) => { navigate(d); setCalOpen(false); }}
            onClose={() => setCalOpen(false)}
          />
        )}
      </div>

      {/* 오른쪽 영역 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110, justifyContent: 'flex-end' }}>
        {/* 내일 → */}
        <button
          style={{
            ...btnBase,
            color: tomorrowDisabled ? 'var(--f4)' : 'var(--f3)',
            cursor: tomorrowDisabled ? 'not-allowed' : 'pointer',
            opacity: tomorrowDisabled ? 0.5 : 1,
          }}
          disabled={tomorrowDisabled}
          onClick={() => !tomorrowDisabled && navigate(tomorrow)}
          onMouseEnter={e => { if (!tomorrowDisabled) (e.currentTarget as HTMLButtonElement).style.color = 'var(--f1)'; }}
          onMouseLeave={e => { if (!tomorrowDisabled) (e.currentTarget as HTMLButtonElement).style.color = 'var(--f3)'; }}
        >
          {formatShortSafe(tomorrow)} →
        </button>

        {/* 오늘로 이동 */}
        {!isToday && (
          <button
            style={{
              background: 'var(--hs-soft)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'var(--mono)',
              color: 'var(--hs)',
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 5,
              whiteSpace: 'nowrap',
            }}
            onClick={() => navigate(today)}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.75'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          >
            오늘로 이동
          </button>
        )}
      </div>
    </div>
  );
}
