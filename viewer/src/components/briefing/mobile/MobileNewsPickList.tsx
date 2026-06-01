'use client';
import { BriefingNewsPick } from '@/lib/queries-briefing';

interface Props {
  picks: BriefingNewsPick[];
}

export default function MobileNewsPickList({ picks }: Props) {
  if (!picks || picks.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
        color: 'var(--f4)', fontFamily: 'var(--mono)', paddingLeft: 2,
      }}>
        외부 뉴스
      </div>
      {picks.map((pick, i) => (
        <a
          key={i}
          href={pick.source_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: '11px 13px',
            border: '1px solid var(--bd)', borderRadius: 10,
            textDecoration: 'none', color: 'inherit',
            background: 'var(--sur)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 9.5, fontFamily: 'var(--mono)',
              color: 'var(--f3)', background: 'var(--snk)',
              padding: '2px 6px', borderRadius: 4, flexShrink: 0,
              border: '1px solid var(--bd)',
            }}>
              {pick.source_name}
            </span>
            <span style={{
              fontSize: 9.5,
              color: pick.relevance >= 5 ? 'var(--shf)' : pick.relevance >= 4 ? 'var(--smf)' : 'var(--f4)',
              fontFamily: 'var(--mono)',
            }}>
              {'★'.repeat(Math.max(0, Math.min(5, pick.relevance)))}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--f1)', lineHeight: 1.4 }}>
            {pick.headline}
          </p>
          {pick.summary && (
            <p style={{
              margin: 0, fontSize: 12, color: 'var(--f3)', lineHeight: 1.55,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {pick.summary}
            </p>
          )}
        </a>
      ))}
    </div>
  );
}
