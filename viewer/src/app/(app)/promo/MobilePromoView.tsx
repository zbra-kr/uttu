'use client';
import { useState, useEffect } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

interface PromoRow {
  id: string;
  title: string;
  promotion_type: string;
  items_count: number;
  end_at: string | null;
  ended_at: string | null;
  snapshot_date: string;
}

const TYPE_CHIPS = [
  { value: 'all',           label: '전체' },
  { value: 'limited_offer', label: '선착순' },
  { value: 'daily_sale',    label: '기획전' },
  { value: 'brand_week',    label: '브랜드위크' },
  { value: 'general',       label: '기타' },
];

const TYPE_LABEL: Record<string, string> = {
  limited_offer: '선착순',
  daily_sale:    '기획전',
  brand_week:    '브랜드위크',
  general:       '기타',
};

const TYPE_COLOR: Record<string, string> = {
  limited_offer: 'var(--td)',
  daily_sale:    'var(--f3)',
  brand_week:    'var(--hs)',
  general:       'var(--f4)',
};

function kstDaysAgo(n: number): string {
  const d = new Date(Date.now() + 9 * 3_600_000);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function isActive(endAt: string | null, endedAt: string | null): boolean {
  if (endedAt) return false;
  if (!endAt) return true;
  return new Date(endAt) > new Date();
}

function fmtEnd(endAt: string | null): string {
  if (!endAt) return '상시';
  return endAt.slice(0, 10).replace(/-/g, '.');
}

export default function MobilePromoView() {
  const [rows, setRows]           = useState<PromoRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.from('promotions')
      .select('id, title, promotion_type, items_count, end_at, ended_at, snapshot_date')
      .gte('snapshot_date', kstDaysAgo(30))
      .order('snapshot_date', { ascending: false })
      .order('end_at', { ascending: true, nullsFirst: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!error && data) setRows(data as PromoRow[]);
        setLoading(false);
      });
  }, []);

  const filtered = typeFilter === 'all' ? rows : rows.filter(r => r.promotion_type === typeFilter);

  const activeCount   = filtered.filter(r => isActive(r.end_at, r.ended_at)).length;
  const inactiveCount = filtered.length - activeCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px', width: '100%', minWidth: 0 }}>
      <MobileFilterChips items={TYPE_CHIPS} activeValue={typeFilter} onChange={setTypeFilter} />

      {/* 요약 KPI */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: '전체', value: filtered.length },
            { label: '진행중', value: activeCount },
            { label: '종료', value: inactiveCount },
          ].map(k => (
            <div key={k.label} style={{
              flex: 1, padding: '10px 12px', background: 'var(--sur)',
              border: '1px solid var(--bd)', borderRadius: 10, textAlign: 'center',
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{k.value}</div>
              <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 2 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <MobileEmptyState icon="🎁" title="프로모션 데이터가 없습니다" />
      ) : (
        filtered.map(r => {
          const active = isActive(r.end_at, r.ended_at);
          return (
            <div key={r.id} style={{
              padding: '12px 13px', background: 'var(--sur)',
              border: '1px solid var(--bd)', borderRadius: 10,
              opacity: active ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                      background: 'var(--snk)', color: TYPE_COLOR[r.promotion_type] ?? 'var(--f4)',
                      border: `0.5px solid ${TYPE_COLOR[r.promotion_type] ?? 'var(--bd)'}`,
                      flexShrink: 0,
                    }}>
                      {TYPE_LABEL[r.promotion_type] ?? r.promotion_type}
                    </span>
                    {!active && (
                      <span style={{ fontSize: 9, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>종료</span>
                    )}
                    {active && (
                      <span style={{ fontSize: 9, color: 'var(--hs)', fontFamily: 'var(--mono)' }}>진행중</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', lineHeight: 1.4 }}>
                    {r.title}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
                <span>상품 {r.items_count.toLocaleString()}개</span>
                <span>종료 {fmtEnd(r.end_at)}</span>
                <span style={{ marginLeft: 'auto' }}>{r.snapshot_date.slice(5)}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
