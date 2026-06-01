'use client';
import { useState, useEffect } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

interface PromoRow {
  id: string;
  promo_type: string;
  title: string;
  start_dt: string | null;
  end_dt: string | null;
  own_sku_count: number;
  brand_names: string[];
}

const TYPE_CHIPS = [
  { value: 'all',       label: '전체' },
  { value: 'time_deal', label: '타임딜' },
  { value: 'sale_tab',  label: '세일탭' },
  { value: 'new',       label: '신상' },
];

const TYPE_ICON: Record<string, string> = {
  time_deal: '⏰',
  sale_tab:  '🔥',
  new:       '✨',
};

function fmtDt(dt: string | null): string {
  if (!dt) return '';
  return dt.slice(0, 10).replace(/-/g, '.');
}

export default function MobilePromoView() {
  const [rows, setRows] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.from('promotions')
      .select('id, promo_type, title, start_dt, end_dt, promotion_items(products(is_own, brands(name)))')
      .order('start_dt', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error || !data) { setLoading(false); return; }

        const processed: PromoRow[] = data.map((p: any) => {
          const items = p.promotion_items ?? [];
          const ownCount = items.filter((i: any) => i.products?.is_own).length;
          const brandSet = new Set<string>(
            items.map((i: any) => i.products?.brands?.name).filter(Boolean)
          );
          return {
            id: p.id,
            promo_type: p.promo_type ?? 'other',
            title: p.title ?? '(무제)',
            start_dt: p.start_dt,
            end_dt: p.end_dt,
            own_sku_count: ownCount,
            brand_names: Array.from(brandSet).slice(0, 3),
          };
        });
        setRows(processed);
        setLoading(false);
      });
  }, []);

  const filtered = typeFilter === 'all' ? rows : rows.filter(r => r.promo_type === typeFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      <MobileFilterChips items={TYPE_CHIPS} activeValue={typeFilter} onChange={setTypeFilter} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <MobileEmptyState icon="🎁" title="프로모션 데이터가 없습니다" />
      ) : (
        filtered.map(r => (
          <div key={r.id} style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>{TYPE_ICON[r.promo_type] ?? '📋'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.title}
                </div>
                {r.brand_names.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--f3)', marginTop: 2 }}>{r.brand_names.join(', ')}</div>
                )}
              </div>
              {r.own_sku_count > 0 && (
                <span style={{ fontSize: 9, fontWeight: 600, flexShrink: 0, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '2px 6px', borderRadius: 4 }}>
                  자사 SKU {r.own_sku_count}개
                </span>
              )}
            </div>
            {(r.start_dt || r.end_dt) && (
              <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 6 }}>
                {fmtDt(r.start_dt)}{r.end_dt ? ` ~ ${fmtDt(r.end_dt)}` : ''}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
