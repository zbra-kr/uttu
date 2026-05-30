'use client';
import { Briefing } from '@/lib/queries-briefing';

interface Props {
  briefing: Briefing;
}

export default function BriefingHeadline({ briefing }: Props) {
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{
        fontSize: 24,
        fontWeight: 600,
        color: 'var(--f1)',
        lineHeight: 1.4,
        margin: 0,
      }}>
        {briefing.headline}
      </p>

      {briefing.daily_brief?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="sec-tag">오늘</span>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {briefing.daily_brief.slice(0, 3).map((line, i) => (
              <li key={i} style={{ fontSize: 14, color: 'var(--f2)', lineHeight: 1.6, display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--f4)', flexShrink: 0 }}>·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {briefing.weekly_brief && briefing.weekly_brief.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="sec-tag">이번 주</span>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {briefing.weekly_brief.slice(0, 3).map((line, i) => (
              <li key={i} style={{ fontSize: 14, color: 'var(--f2)', lineHeight: 1.6, display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--f4)', flexShrink: 0 }}>·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>
        {briefing.briefing_date} · {briefing.model}
      </div>
    </div>
  );
}
