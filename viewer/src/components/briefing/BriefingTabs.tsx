'use client';
import { Briefing } from '@/lib/queries-briefing';
import BriefingDateNav from './BriefingDateNav';

interface Tab {
  key: 'executive' | 'staff' | 'cs';
  label: string;
  briefing: Briefing | null;
}

interface Props {
  active: 'executive' | 'staff' | 'cs';
  executive: Briefing | null;
  staff: Briefing | null;
  cs: Briefing | null;
  onSelect: (tab: 'executive' | 'staff' | 'cs') => void;
  currentDate: string;
  availableDates: string[];
}

const TABS: { key: Tab['key']; label: string }[] = [
  { key: 'executive', label: '경영진' },
  { key: 'staff',     label: '기획/영업' },
  { key: 'cs',        label: 'CS' },
];

export default function BriefingTabs({ active, executive, staff, cs, onSelect, currentDate, availableDates }: Props) {
  const briefings = { executive, staff, cs };

  return (
    <div style={{
      background: 'var(--bg)',
      flexShrink: 0,
      paddingTop: 6,
      paddingLeft: 22,
      paddingRight: 22,
      paddingBottom: 0,
    }}>
      {/* 날짜 네비게이션 */}
      <BriefingDateNav
        currentDate={currentDate}
        activeTab={active}
        availableDates={availableDates}
      />

      {/* 탭 버튼 */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '0.5px solid var(--bs)',
      }}>
        {TABS.map(({ key, label }) => {
          const b = briefings[key];
          const isActive = active === key;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              style={{
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--f1)' : 'var(--f3)',
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--hs)' : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                minWidth: 100,
              }}
            >
              <span>{label}</span>
              {b?.headline && (
                <span style={{
                  fontSize: 11,
                  color: isActive ? 'var(--f2)' : 'var(--f4)',
                  fontWeight: 400,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  maxWidth: 180,
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
