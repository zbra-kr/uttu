'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchLatestRanking, type RankingRow } from '@/lib/queries';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileBottomSheet from '@/components/mobile/MobileBottomSheet';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import MobileSegmentBadge from '@/components/mobile/MobileSegmentBadge';

const CATEGORIES = [
  { value: '000', label: '전체' },
  { value: '001', label: '상의' },
  { value: '002', label: '아우터' },
  { value: '003', label: '바지' },
  { value: '004', label: '가방' },
  { value: '017', label: '스포츠/레저' },
  { value: '026', label: '속옷/홈웨어' },
  { value: '100', label: '원피스/스커트' },
  { value: '101', label: '소품' },
  { value: '103', label: '신발' },
  { value: '104', label: '뷰티' },
];

const GENDER_OPTS = [
  { value: 'A', label: '전체' },
  { value: 'M', label: '남성' },
  { value: 'F', label: '여성' },
];

const AGE_OPTS = [
  { value: 'AGE_BAND_ALL',   label: '전체' },
  { value: 'AGE_BAND_MINOR', label: '20세 미만' },
  { value: 'AGE_BAND_20',    label: '20대 초반' },
  { value: 'AGE_BAND_25',    label: '20대 후반' },
  { value: 'AGE_BAND_30',    label: '30대 초반' },
  { value: 'AGE_BAND_35',    label: '30대 후반' },
  { value: 'AGE_BAND_40',    label: '40대 이상' },
];

function fmtPrice(v: number | null) {
  if (v == null) return '';
  return `${(v / 10000).toFixed(1)}만`;
}

function RankChange({ change }: { change: number | null }) {
  if (change == null) return <span style={{ fontSize: 10, color: 'var(--hs)', fontFamily: 'var(--mono)' }}>NEW</span>;
  if (change === 0) return <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>–</span>;
  return (
    <span style={{ fontSize: 10, color: change > 0 ? 'var(--tu)' : 'var(--td)', fontFamily: 'var(--mono)' }}>
      {change > 0 ? '▲' : '▼'}{Math.abs(change)}
    </span>
  );
}

const PAGE_SIZE = 50;

export default function MobileRankingView() {
  const router = useRouter();
  const [cat, setCat] = useState('000');
  const [gf, setGf] = useState('A');
  const [age, setAge] = useState('AGE_BAND_ALL');
  const [pendingGf, setPendingGf] = useState('A');
  const [pendingAge, setPendingAge] = useState('AGE_BAND_ALL');
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const loaderRef = useRef<HTMLDivElement>(null);

  const displayed = rows.slice(0, page * PAGE_SIZE);

  useEffect(() => {
    setLoading(true);
    setPage(1);
    fetchLatestRanking({ categoryCode: cat, genderFilter: gf, ageFilter: age, limit: 300 })
      .then(data => {
        setRows(data);
        setShowMore(data.length > PAGE_SIZE);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [cat, gf, age]);

  const gfLabel = GENDER_OPTS.find(o => o.value === gf)?.label ?? gf;
  const ageLabel = AGE_OPTS.find(o => o.value === age)?.label ?? age;

  const handleApplyFilter = useCallback(() => {
    setGf(pendingGf);
    setAge(pendingAge);
    setFilterOpen(false);
  }, [pendingGf, pendingAge]);

  // 무한 스크롤
  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && displayed.length < rows.length) {
        setPage(p => p + 1);
      }
    }, { threshold: 0.1 });
    ob.observe(el);
    return () => ob.disconnect();
  }, [displayed.length, rows.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      {/* 카테고리 칩 */}
      <MobileFilterChips items={CATEGORIES} activeValue={cat} onChange={v => { setCat(v); setPage(1); }} />

      {/* 필터 표시 + 변경 버튼 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <MobileSegmentBadge label={`gf=${gf}`} />
        <MobileSegmentBadge label={`age=${ageLabel}`} />
        <button
          onClick={() => { setPendingGf(gf); setPendingAge(age); setFilterOpen(true); }}
          style={{
            marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--mono)',
            color: 'var(--f3)', background: 'var(--sur)',
            border: '1px solid var(--bd)', borderRadius: 6,
            padding: '3px 8px', cursor: 'pointer',
          }}
        >
          필터 변경
        </button>
      </div>

      {/* 리스트 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      ) : rows.length === 0 ? (
        <MobileEmptyState icon="📊" title="랭킹 데이터가 없습니다" description="조건을 변경해보세요" />
      ) : (
        <>
          {displayed.map((r, i) => (
            <div
              key={`${r.musinsa_no}-${i}`}
              onClick={() => router.push(`/product?no=${r.musinsa_no}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', background: 'var(--sur)',
                border: `1px solid ${r.is_own ? 'var(--hs)' : 'var(--bd)'}`,
                borderRadius: 10, cursor: 'pointer',
              }}
            >
              {/* 랭킹 */}
              <div style={{ width: 32, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)', color: r.rank_position <= 3 ? 'var(--hs)' : 'var(--f1)' }}>
                  {r.rank_position}
                </span>
                <RankChange change={r.rank_change} />
              </div>

              {/* 썸네일 */}
              {r.thumbnail_url ? (
                <img src={r.thumbnail_url} alt="" width={40} height={40} style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--snk)', flexShrink: 0 }} />
              )}

              {/* 텍스트 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.product_name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--f3)' }}>{r.brand_name}</span>
                  {r.is_own && (
                    <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 4px', borderRadius: 3 }}>
                      자사
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  {r.final_price != null ? fmtPrice(r.final_price) : fmtPrice(r.list_price)}
                  {r.discount_rate != null && r.discount_rate > 0 && (
                    <span style={{ color: 'var(--td)', marginLeft: 4 }}>-{Math.round(r.discount_rate)}%</span>
                  )}
                </div>
              </div>

              <span style={{ color: 'var(--f4)', fontSize: 14, flexShrink: 0 }}>→</span>
            </div>
          ))}

          {/* 무한 스크롤 트리거 */}
          {displayed.length < rows.length && (
            <div ref={loaderRef} style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--f4)', fontSize: 12 }}>
              불러오는 중...
            </div>
          )}
        </>
      )}

      {/* 필터 시트 */}
      <MobileBottomSheet open={filterOpen} onClose={() => setFilterOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>성별</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {GENDER_OPTS.map(o => (
                <button key={o.value} onClick={() => setPendingGf(o.value)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  background: pendingGf === o.value ? 'var(--hs-soft)' : 'var(--sur)',
                  color: pendingGf === o.value ? 'var(--hs)' : 'var(--f2)',
                  border: `1px solid ${pendingGf === o.value ? 'var(--hs)' : 'var(--bd)'}`,
                }}>{o.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>연령대</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {AGE_OPTS.map(o => (
                <button key={o.value} onClick={() => setPendingAge(o.value)} style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left',
                  background: pendingAge === o.value ? 'var(--hs-soft)' : 'var(--sur)',
                  color: pendingAge === o.value ? 'var(--hs)' : 'var(--f2)',
                  border: `1px solid ${pendingAge === o.value ? 'var(--hs)' : 'var(--bd)'}`,
                }}>{o.label}</button>
              ))}
            </div>
          </div>
          <button onClick={handleApplyFilter} style={{
            padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 600,
            background: 'var(--hs)', color: 'var(--sur)', border: 'none', cursor: 'pointer',
          }}>
            적용
          </button>
        </div>
      </MobileBottomSheet>
    </div>
  );
}
