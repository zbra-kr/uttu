'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { fetchBrandLeaderboard, searchBrands, type BrandLeaderRow } from '@/lib/queries';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

const CATEGORIES = [
  { value: '000', label: '전체' },
  { value: '001', label: '상의' },
  { value: '002', label: '아우터' },
  { value: '003', label: '바지' },
  { value: '004', label: '가방' },
  { value: '017', label: '스포츠/레저' },
  { value: '103', label: '신발' },
  { value: '104', label: '뷰티' },
];

type SearchResult = { id: string; name: string; slug: string; company_name?: string | null };

function RankChange({ change }: { change: number | null }) {
  if (change == null) return null;
  if (change === 0) return <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>–</span>;
  return (
    <span style={{ fontSize: 10, color: change > 0 ? 'var(--tu)' : 'var(--td)', fontFamily: 'var(--mono)' }}>
      {change > 0 ? '▲' : '▼'}{Math.abs(change)}
    </span>
  );
}

export default function MobileBrandRankingView() {
  const router = useRouter();
  const [cat, setCat] = useState('000');
  const [rows, setRows] = useState<BrandLeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    fetchBrandLeaderboard({ categoryCode: cat, genderFilter: 'A', ageFilter: 'AGE_BAND_ALL' })
      .then(data => { setRows(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [cat]);

  const handleSearch = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!value.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    timerRef.current = setTimeout(() => {
      searchBrands(value.trim(), 30)
        .then(results => { setSearchResults(results); setSearchLoading(false); })
        .catch(() => setSearchLoading(false));
    }, 280);
  };

  const isSearching = query.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px', width: '100%', minWidth: 0 }}>

      {/* 검색바 */}
      <div style={{ position: 'sticky', top: 0, background: 'var(--bg)', paddingTop: 4, paddingBottom: 4, zIndex: 10 }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--f4)', pointerEvents: 'none' }}>⌕</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="브랜드명 · 회사명 검색"
            value={query}
            onChange={e => handleSearch(e.target.value)}
            style={{
              width: '100%', padding: '9px 34px 9px 32px', borderRadius: 10,
              border: `1px solid ${isSearching ? 'var(--hs)' : 'var(--bd)'}`,
              background: 'var(--sur)', color: 'var(--f1)',
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
              fontFamily: 'var(--sans)',
            }}
          />
          {isSearching && (
            <button
              onClick={() => { setQuery(''); setSearchResults([]); inputRef.current?.focus(); }}
              style={{
                position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
                width: 18, height: 18, borderRadius: '50%', background: 'var(--f4)',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: 'var(--bg)', fontSize: 10, fontWeight: 700, padding: 0,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {isSearching ? (
        /* ── 검색 결과 ── */
        searchLoading ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--f4)', fontSize: 13 }}>검색 중...</div>
        ) : searchResults.length === 0 ? (
          <MobileEmptyState icon="🔍" title="검색 결과가 없습니다" />
        ) : (
          <>
            <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', paddingLeft: 2 }}>
              검색 결과 {searchResults.length}개
            </div>
            {searchResults.map(r => (
              <div
                key={r.id}
                onClick={() => router.push(`/brand?id=${r.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 13px', background: 'var(--sur)',
                  border: '1px solid var(--bd)', borderRadius: 10, cursor: 'pointer',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--f1)' }}>{r.name}</div>
                  {r.company_name && (
                    <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>{r.company_name}</div>
                  )}
                </div>
                <span style={{ color: 'var(--f4)', fontSize: 14, flexShrink: 0 }}>→</span>
              </div>
            ))}
          </>
        )
      ) : (
        /* ── 브랜드 랭킹 ── */
        <>
          <MobileFilterChips items={CATEGORIES} activeValue={cat} onChange={setCat} />
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
          ) : rows.length === 0 ? (
            <MobileEmptyState icon="🏆" title="브랜드 랭킹 데이터가 없습니다" />
          ) : (
            rows.map((r, i) => (
              <div
                key={r.brand_id ?? r.brand_name}
                onClick={() => r.brand_id && router.push(`/brand?id=${r.brand_id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 13px', background: 'var(--sur)',
                  border: `1px solid ${r.is_own ? 'var(--hs)' : 'var(--bd)'}`,
                  borderRadius: 10, cursor: r.brand_id ? 'pointer' : 'default',
                }}
              >
                <div style={{ width: 36, flexShrink: 0, textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)', color: i < 3 ? 'var(--hs)' : 'var(--f1)' }}>
                    #{i + 1}
                  </div>
                  <RankChange change={r.brand_rank_change} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--f1)' }}>{r.brand_name}</span>
                    {r.is_own && (
                      <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 4px', borderRadius: 3 }}>
                        자사
                      </span>
                    )}
                    {r.nation_name && (
                      <span style={{ fontSize: 10, color: 'var(--f4)' }}>{r.nation_name}</span>
                    )}
                  </div>
                  {r.company_name && (
                    <div style={{ fontSize: 11, color: 'var(--f3)', marginTop: 2 }}>{r.company_name}</div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 3 }}>
                    TOP100 {r.top100_count}개
                    {r.avg_rank != null && ` · 평균 ${Math.round(r.avg_rank)}위`}
                  </div>
                </div>
                {r.brand_id && <span style={{ color: 'var(--f4)', fontSize: 14, flexShrink: 0 }}>→</span>}
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
