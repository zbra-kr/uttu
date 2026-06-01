'use client';
import { Briefing } from '@/lib/queries-briefing';

type AudienceKey = 'executive' | 'staff' | 'cs';

interface Props {
  active: AudienceKey;
  executive: Briefing | null;
  staff: Briefing | null;
  cs: Briefing | null;
  onSelect: (tab: AudienceKey) => void;
  currentDate: string;
  availableDates: string[];
  onDateChange: (date: string) => void;
}

const TABS: { key: AudienceKey; label: string }[] = [
  { key: 'executive', label: '경영진' },
  { key: 'staff',     label: '기획/영업' },
  { key: 'cs',        label: 'CS' },
];

function formatDateKr(date: string): string {
  const d = new Date(date + 'T00:00:00');
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} (${days[d.getDay()]})`;
}

export default function MobileBriefingTabs({
  active, executive, staff, cs, onSelect,
  currentDate, availableDates, onDateChange,
}: Props) {
  const briefings = { executive, staff, cs };

  const sorted = [...availableDates].sort().reverse();
  const idx = sorted.indexOf(currentDate);
  const hasPrev = idx < sorted.length - 1;
  const hasNext = idx > 0;

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const isToday = currentDate === today;

  const navBtn = (label: string, enabled: boolean, onClick: () => void) => (
    <button
      onClick={enabled ? onClick : undefined}
      style={{
        background: 'none', border: 'none', padding: '0 4px',
        cursor: enabled ? 'pointer' : 'default',
        color: enabled ? 'var(--f2)' : 'var(--f4)',
        fontSize: 12, lineHeight: 1,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: 'var(--sur)', borderBottom: '1px solid var(--bs)',
    }}>
      {/* 날짜 네비 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px 6px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          fontSize: 12, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--f1)',
        }}>
          {navBtn('◀', hasPrev, () => onDateChange(sorted[idx + 1]))}
          <span style={{ margin: '0 4px' }}>{formatDateKr(currentDate)}</span>
          {navBtn('▶', hasNext, () => onDateChange(sorted[idx - 1]))}
        </div>
        {!isToday && (
          <button
            onClick={() => onDateChange(today)}
            style={{
              fontSize: 10, color: 'var(--f2)', padding: '3px 9px',
              background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 6,
              cursor: 'pointer', fontFamily: 'var(--mono)',
            }}
          >
            오늘로
          </button>
        )}
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', overflowX: 'auto', padding: '0 8px' }}>
        {TABS.map(({ key, label }) => {
          const b = briefings[key];
          const isActive = active === key;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              style={{
                padding: '8px 12px 9px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--hs)' : 'var(--f3)',
                background: 'none', border: 'none',
                borderBottom: isActive ? '2px solid var(--hs)' : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                minWidth: 80, flexShrink: 0,
                fontFamily: 'var(--mono)',
              }}
            >
              <span>{label}</span>
              {b?.headline && (
                <span style={{
                  fontSize: 10,
                  color: isActive ? 'var(--f2)' : 'var(--f4)',
                  fontWeight: 400,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  maxWidth: 130,
                  display: 'block',
                }}>
                  {b.headline}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
