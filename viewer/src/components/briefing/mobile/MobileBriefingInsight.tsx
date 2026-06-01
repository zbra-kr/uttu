'use client';
import Link from 'next/link';
import { BriefingInsight as InsightData } from '@/lib/queries-briefing';

interface Props {
  insights: InsightData[];
}

export default function MobileBriefingInsight({ insights }: Props) {
  if (!insights || insights.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {insights.map((item, i) => (
        <div
          key={i}
          style={{
            background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 10,
            padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 6,
          }}
        >
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 11,
            color: 'var(--hs)', fontWeight: 700, letterSpacing: '0.04em',
          }}>
            #{String(i + 1).padStart(2, '0')}
          </span>
          <p style={{
            margin: 0, fontSize: 16, fontWeight: 600,
            color: 'var(--f1)', lineHeight: 1.35, letterSpacing: '-0.01em',
          }}>
            {item.title}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--f2)', lineHeight: 1.7 }}>
            {item.body}
          </p>
          {item.link && item.link.startsWith('/') && (
            <Link
              href={item.link}
              style={{
                fontSize: 12, color: 'var(--hs)', textDecoration: 'none',
                fontFamily: 'var(--mono)', marginTop: 2, display: 'inline-block',
              }}
            >
              → 보기
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
