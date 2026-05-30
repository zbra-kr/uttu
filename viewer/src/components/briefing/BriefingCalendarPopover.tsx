'use client';
import { useEffect, useRef, useState } from 'react';
import { kstToday } from '@/lib/queries-briefing';

interface Props {
  currentDate: string;
  availableDates: string[];
  onSelect: (date: string) => void;
  onClose: () => void;
}

const KO_DAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

function toDateStr(y: number, m0: number, d: number): string {
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function BriefingCalendarPopover({ currentDate, availableDates, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const today = kstToday();

  const [cy, cm] = currentDate.split('-').map(Number);
  const [viewYear, setViewYear] = useState(cy);
  const [viewMonth, setViewMonth] = useState(cm - 1); // 0-indexed

  const availableSet = new Set(availableDates);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  const [ty, tm] = today.split('-').map(Number); // tm is 1-indexed

  // Prev/next month navigation constraints
  const nextM0 = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextY  = viewMonth === 11 ? viewYear + 1 : viewYear;
  const nextDisabled = nextY > ty || (nextY === ty && nextM0 + 1 > tm);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (nextDisabled) return;
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  // Build calendar grid
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const numDays  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(toDateStr(viewYear, viewMonth, d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        background: 'var(--sur)',
        border: '0.5px solid var(--bd)',
        borderRadius: 10,
        padding: '10px 10px 12px',
        minWidth: 230,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
      }}
    >
      {/* 월 이동 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button
          onClick={prevMonth}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--f2)', fontSize: 16, padding: '2px 8px', borderRadius: 4, lineHeight: 1 }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--snk)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
        >
          ‹
        </button>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>
          {viewYear}년 {viewMonth + 1}월
        </span>
        <button
          onClick={nextMonth}
          disabled={nextDisabled}
          style={{
            background: 'none', border: 'none',
            cursor: nextDisabled ? 'not-allowed' : 'pointer',
            color: nextDisabled ? 'var(--f4)' : 'var(--f2)',
            fontSize: 16, padding: '2px 8px', borderRadius: 4, lineHeight: 1,
            opacity: nextDisabled ? 0.35 : 1,
          }}
          onMouseEnter={e => { if (!nextDisabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--snk)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
        >
          ›
        </button>
      </div>

      {/* 요일 헤더 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 2 }}>
        {KO_DAY_SHORT.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, color: 'var(--f4)', padding: '1px 0', fontFamily: 'var(--mono)' }}>
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={i} style={{ padding: '5px 0' }} />;

          const isSelected = dateStr === currentDate;
          const isToday    = dateStr === today;
          const isFuture   = dateStr > today;
          const hasData    = availableSet.has(dateStr);
          const isDisabled = isFuture || !hasData;

          let bg     = 'transparent';
          let color  = 'var(--f1)';
          let cursor = 'pointer';
          let opacity: number | string = 1;

          if (isSelected)       { bg = 'var(--hs)';      color = 'var(--rai)'; }
          else if (isToday)     { bg = 'var(--hs-soft)'; }
          else if (isFuture)    { color = 'var(--f3)';  opacity = 0.4; cursor = 'not-allowed'; }
          else if (!hasData)    { color = 'var(--f4)';  opacity = 0.45; cursor = 'not-allowed'; }

          const dayNum = dateStr.split('-')[2].replace(/^0/, '');

          return (
            <div
              key={i}
              onClick={() => !isDisabled && onSelect(dateStr)}
              style={{
                textAlign: 'center',
                fontSize: 11,
                padding: '4px 1px',
                borderRadius: 5,
                cursor,
                background: bg,
                color,
                opacity,
                position: 'relative',
                userSelect: 'none',
                lineHeight: 1.4,
              }}
              onMouseEnter={e => {
                if (!isDisabled && !isSelected)
                  (e.currentTarget as HTMLDivElement).style.background = 'var(--snk)';
              }}
              onMouseLeave={e => {
                if (!isDisabled && !isSelected)
                  (e.currentTarget as HTMLDivElement).style.background = bg;
              }}
            >
              {dayNum}
              {/* 데이터 있는 날: 하단 도트 */}
              {hasData && !isFuture && !isSelected && (
                <div style={{
                  position: 'absolute',
                  bottom: 1,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 3,
                  height: 3,
                  borderRadius: '50%',
                  background: 'var(--hs)',
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
