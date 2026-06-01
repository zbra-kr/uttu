'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { fetchCompanyList, type CompanyListRow } from '@/lib/queries';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

type SortKey = 'revenue' | 'op_margin' | 'brand_count';

const SORT_OPTS = [
  { value: 'revenue',    label: '매출순' },
  { value: 'op_margin',  label: '이익률순' },
  { value: 'brand_count', label: '브랜드수' },
];

function fmtB(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(1)}조`;
  if (abs >= 100_000_000)       return `${Math.round(v / 100_000_000).toLocaleString()}억`;
  if (abs >= 10_000)            return `${Math.round(v / 10_000).toLocaleString()}만`;
  return v.toLocaleString();
}

export default function MobileCompaniesView() {
  const router = useRouter();
  const [rows, setRows] = useState<CompanyListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [listedOnly, setListedOnly] = useState(false);

  useEffect(() => {
    fetchCompanyList()
      .then(data => { setRows(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (listedOnly) list = list.filter(r => r.is_listed);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.corp_name.toLowerCase().includes(q) ||
        r.top_brands.some(b => b.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      if (sortKey === 'revenue')     return (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity);
      if (sortKey === 'op_margin')   return (b.op_margin ?? -Infinity) - (a.op_margin ?? -Infinity);
      return b.brand_count - a.brand_count;
    });
  }, [rows, search, sortKey, listedOnly]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      {/* 검색 */}
      <div style={{ position: 'sticky', top: 0, background: 'var(--bg)', paddingTop: 4, paddingBottom: 4, zIndex: 10 }}>
        <input
          type="text"
          placeholder="회사명·브랜드명 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '9px 12px', borderRadius: 8,
            border: '1px solid var(--bd)', background: 'var(--sur)',
            color: 'var(--f1)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
            fontFamily: 'var(--sans)',
          }}
        />
      </div>

      {/* 정렬 + 상장 토글 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <MobileFilterChips items={SORT_OPTS} activeValue={sortKey} onChange={v => setSortKey(v as SortKey)} />
        <button
          onClick={() => setListedOnly(p => !p)}
          style={{
            flexShrink: 0, padding: '6px 10px', borderRadius: 16, fontSize: 11, fontFamily: 'var(--mono)',
            border: `1px solid ${listedOnly ? 'var(--hs)' : 'var(--bd)'}`,
            background: listedOnly ? 'var(--hs-soft)' : 'var(--sur)',
            color: listedOnly ? 'var(--hs)' : 'var(--f3)',
            cursor: 'pointer',
          }}
        >
          상장만
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <MobileEmptyState icon="🏢" title="검색 결과가 없습니다" />
      ) : (
        filtered.map(r => (
          <div
            key={r.id}
            onClick={() => router.push(`/company?id=${r.id}`)}
            style={{
              padding: '12px 13px', background: 'var(--sur)',
              border: '1px solid var(--bd)', borderRadius: 10, cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--f1)', flex: 1 }}>{r.corp_name}</span>
              {r.is_listed && (
                <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--slf)', background: 'var(--slb)', padding: '1px 5px', borderRadius: 3 }}>
                  DART ✓
                </span>
              )}
              {r.own_brand_count > 0 && (
                <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 5px', borderRadius: 3 }}>
                  자사
                </span>
              )}
              <span style={{ color: 'var(--f4)', fontSize: 14 }}>→</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--f3)', marginTop: 3 }}>
              브랜드 {r.brand_count}개
              {r.top_brands.length > 0 && ` · ${r.top_brands.slice(0, 2).join(', ')}`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 4, display: 'flex', gap: 12 }}>
              <span>매출 {fmtB(r.revenue)}</span>
              {r.op_margin != null && <span>영업이익률 {r.op_margin.toFixed(1)}%</span>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
