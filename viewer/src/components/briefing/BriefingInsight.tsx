'use client';
import Link from 'next/link';
import { BriefingInsight as InsightData } from '@/lib/queries-briefing';

interface Props {
  insights: InsightData[];
  briefingDate?: string;
  audience?: string;
}

export default function BriefingInsight({ insights, briefingDate, audience }: Props) {
  if (!insights || insights.length === 0) return null;

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span className="sec-tag">인사이트</span>
      {insights.map((item, i) => {
        const detailHref = briefingDate && audience
          ? `/today/insight?date=${briefingDate}&audience=${audience}&idx=${i}`
          : item.link?.startsWith('/') ? item.link : null;

        return (
          <div key={i} style={{ display: 'flex', gap: 12 }}>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 11,
              color: 'var(--hs)', fontWeight: 600, flexShrink: 0, paddingTop: 2,
            }}>
              #{String(i + 1).padStart(2, '0')}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--f1)' }}>
                {item.title}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--f2)', lineHeight: 1.6 }}>
                {item.body}
              </p>
              {detailHref && (
                <Link
                  href={detailHref}
                  style={{ fontSize: 12, color: 'var(--hs)', textDecoration: 'none', marginTop: 2 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none'; }}
                >
                  자세히 보기 →
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
