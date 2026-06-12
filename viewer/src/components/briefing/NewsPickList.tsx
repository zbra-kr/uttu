'use client';
import { BriefingNewsPick } from '@/lib/queries-briefing';

interface Props {
  picks: BriefingNewsPick[];
}

export default function NewsPickList({ picks }: Props) {
  if (!picks || picks.length === 0) return null;

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span className="sec-tag">외부 뉴스</span>
      {picks.map((pick, i) => (
        <a
          key={i}
          href={pick.source_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '10px 12px',
            border: '0.5px solid var(--bd)',
            borderRadius: 7,
            textDecoration: 'none',
            color: 'inherit',
            background: 'var(--bg)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = 'var(--snk)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg)';
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 10,
              fontFamily: 'var(--mono)',
              color: 'var(--f4)',
              background: 'var(--sur)',
              padding: '2px 6px',
              borderRadius: 5,
              flexShrink: 0,
            }}>
              {pick.source_name}
            </span>
            <span style={{
              fontSize: 10,
              fontFamily: 'var(--mono)',
              color: pick.relevance >= 5 ? 'var(--shf)' : pick.relevance >= 4 ? 'var(--smf)' : 'var(--f4)',
            }}>
              {'★'.repeat(pick.relevance)}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--f1)', lineHeight: 1.4 }}>
            {pick.headline}
          </p>
          <p style={{
            margin: 0,
            fontSize: 12,
            color: 'var(--f3)',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {pick.summary}
          </p>
        </a>
      ))}
    </div>
  );
}
