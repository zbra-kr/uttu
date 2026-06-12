'use client';
import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fetchAllBriefings, type InsightPage } from '@/lib/queries-briefing';

const CM = { top: 4, right: 4, bottom: 4, left: -16 };

function InsightChart({ chart }: { chart: NonNullable<InsightPage['chart']> }) {
  const data = chart.x_labels.map((label, i) => {
    const point: Record<string, string | number> = { name: label };
    chart.series.forEach(s => { point[s.name] = s.values[i] ?? 0; });
    return point;
  });

  const colors = ['var(--hs)', 'var(--slf)', 'var(--smf)', 'var(--shf)'];

  return (
    <div style={{ padding: '0 16px 20px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--f3)', marginBottom: 10 }}>
        {chart.title}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        {chart.type === 'bar' ? (
          <BarChart data={data} margin={CM}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--f4)' }} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--f4)' }} reversed={chart.reversed} />
            <Tooltip contentStyle={{ background: 'var(--sur)', border: '1px solid var(--bd)', fontSize: 12 }} />
            {chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {chart.series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={colors[i % colors.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={data} margin={CM}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--f4)' }} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--f4)' }} reversed={chart.reversed} />
            <Tooltip contentStyle={{ background: 'var(--sur)', border: '1px solid var(--bd)', fontSize: 12 }} />
            {chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {chart.series.map((s, i) => (
              <Line key={s.name} type="monotone" dataKey={s.name} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function InsightPageContent({ page, audience, date }: { page: InsightPage; audience: string; date: string }) {
  const AUD_LABEL: Record<string, string> = { executive: '임원', staff: '스태프', cs: 'CS' };

  return (
    <article>
      {/* 헤더 */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--bd)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, fontFamily: 'var(--mono)',
            color: 'var(--hs)', background: 'var(--hs-soft)', padding: '2px 7px', borderRadius: 10,
          }}>
            {AUD_LABEL[audience] ?? audience}
          </span>
          <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{date}</span>
          <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
            #{String(page.idx + 1).padStart(2, '0')}
          </span>
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--f1)', lineHeight: 1.35, letterSpacing: '-0.02em' }}>
          {page.title}
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--f3)', lineHeight: 1.6 }}>
          {page.body}
        </p>
      </div>

      {/* 핵심 지표 */}
      {page.key_metrics.length > 0 && (
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {page.key_metrics.map((m, i) => (
              <div key={i} style={{
                flex: '1 1 calc(50% - 4px)', minWidth: 120,
                padding: '10px 12px', background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 10,
              }}>
                <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 4 }}>{m.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{m.value}</span>
                  {m.change && (
                    <span style={{
                      fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 600,
                      color: m.change.startsWith('+') ? 'var(--slf)' : m.change.startsWith('-') ? 'var(--shf)' : 'var(--f4)',
                    }}>
                      {m.change}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 기사 본문 */}
      <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--bd)' }}>
        {page.article.split('\n\n').map((para, i) => (
          <p key={i} style={{ margin: i === 0 ? 0 : '14px 0 0', fontSize: 14, color: 'var(--f1)', lineHeight: 1.8 }}>
            {para}
          </p>
        ))}
      </div>

      {/* 차트 */}
      {page.chart && (
        <div style={{ paddingTop: 20, borderBottom: '1px solid var(--bd)' }}>
          <InsightChart chart={page.chart} />
        </div>
      )}

      {/* 원본 페이지 이동 */}
      {page.link && (
        <div style={{ padding: '16px 16px 0' }}>
          <Link
            href={page.link}
            style={{
              display: 'block', textAlign: 'center', padding: '13px 0',
              background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10,
              fontSize: 14, fontWeight: 600, color: 'var(--f1)', textDecoration: 'none',
            }}
          >
            전체 데이터 보기 →
          </Link>
        </div>
      )}
    </article>
  );
}

function InsightDetailContent() {
  const router = useRouter();
  const params = useSearchParams();
  const date     = params.get('date') ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const audience = (params.get('audience') ?? 'executive') as 'executive' | 'staff' | 'cs';
  const idx      = parseInt(params.get('idx') ?? '0', 10);

  const [page, setPage] = useState<InsightPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetchAllBriefings(date).then(data => {
      const briefing = data[audience];
      const pages = briefing?.insight_pages ?? [];
      setTotal(pages.length);
      setPage(pages[idx] ?? null);
      setLoading(false);
    });
  }, [date, audience, idx]);

  const goTo = (newIdx: number) => {
    const p = new URLSearchParams({ date, audience, idx: String(newIdx) });
    router.push(`/today/insight?${p.toString()}`);
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', paddingBottom: 40 }}>
      {/* 상단 네비 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '14px 16px', borderBottom: '1px solid var(--bd)',
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10,
      }}>
        <button
          onClick={() => router.back()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--f3)', fontSize: 20, padding: '0 4px', lineHeight: 1 }}
        >
          ←
        </button>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>인사이트</span>
        {total > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={() => goTo(idx - 1)} disabled={idx === 0}
              style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 5, padding: '4px 10px', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: 'var(--f3)', fontSize: 13, opacity: idx === 0 ? 0.4 : 1 }}
            >
              ‹
            </button>
            <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{idx + 1} / {total}</span>
            <button
              onClick={() => goTo(idx + 1)} disabled={idx >= total - 1}
              style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 5, padding: '4px 10px', cursor: idx >= total - 1 ? 'not-allowed' : 'pointer', color: 'var(--f3)', fontSize: 13, opacity: idx >= total - 1 ? 0.4 : 1 }}
            >
              ›
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : !page ? (
        <div style={{ textAlign: 'center', padding: '60px 16px', color: 'var(--f3)' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📭</div>
          <div style={{ fontSize: 13 }}>아직 생성된 상세 페이지가 없습니다.</div>
          <div style={{ fontSize: 12, color: 'var(--f4)', marginTop: 6 }}>브리핑 재생성 시 함께 만들어집니다.</div>
        </div>
      ) : (
        <InsightPageContent page={page} audience={audience} date={date} />
      )}
    </div>
  );
}

export default function InsightDetailPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>}>
      <InsightDetailContent />
    </Suspense>
  );
}
