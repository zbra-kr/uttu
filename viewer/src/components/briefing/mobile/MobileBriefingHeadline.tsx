'use client';
import { Briefing } from '@/lib/queries-briefing';

interface Props {
  briefing: Briefing;
}

const TAG_STYLE: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--f4)',
  fontFamily: 'var(--mono)',
};

const BULLET_LIST_STYLE: React.CSSProperties = {
  margin: 0, padding: 0, listStyle: 'none',
  display: 'flex', flexDirection: 'column', gap: 5,
};

export default function MobileBriefingHeadline({ briefing }: Props) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      padding: 14,
      background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10,
    }}>
      <p style={{
        fontSize: 22, fontWeight: 600,
        color: 'var(--f1)', lineHeight: 1.35, margin: 0,
        fontFamily: 'var(--mono)', letterSpacing: '-0.02em',
      }}>
        {briefing.headline}
      </p>

      {briefing.daily_brief?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={TAG_STYLE}>오늘</span>
          <ul style={BULLET_LIST_STYLE}>
            {briefing.daily_brief.slice(0, 3).map((line, i) => (
              <li key={i} style={{ fontSize: 13, color: 'var(--f2)', lineHeight: 1.7, display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--f4)', flexShrink: 0 }}>·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {briefing.weekly_brief && briefing.weekly_brief.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={TAG_STYLE}>이번 주</span>
          <ul style={BULLET_LIST_STYLE}>
            {briefing.weekly_brief.slice(0, 3).map((line, i) => (
              <li key={i} style={{ fontSize: 13, color: 'var(--f2)', lineHeight: 1.7, display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--f4)', flexShrink: 0 }}>·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
        {briefing.briefing_date} · {briefing.model}
      </div>
    </div>
  );
}
