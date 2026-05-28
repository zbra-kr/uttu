'use client';
import React from 'react';
import { IcCheck, IcX, IcPlus } from '@/components/ui/icons';
import {
  fetchOwnBrands, type OwnBrand,
  fetchOwnProducts, type OwnProduct,
  fetchCompetitorBrands, addCompetitorBrand, removeCompetitorBrand,
  searchBrandsForPool, type CompetitorBrandRow, type BrandSearchRow,
  fetchProductMatches, setMatchStatus, runAutoMatch, type ProductMatchRow,
} from '@/lib/queries';

// ── 경쟁 브랜드 풀 탭 ─────────────────────────────────────────────

function BrandPool() {
  const [ownBrands, setOwnBrands] = React.useState<OwnBrand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = React.useState<string | null>(null);
  const [pool, setPool] = React.useState<CompetitorBrandRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const [results, setResults] = React.useState<BrandSearchRow[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [adding, setAdding] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const searchRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    fetchOwnBrands()
      .then((brands) => {
        setOwnBrands(brands);
        if (brands.length > 0) setSelectedBrandId(brands[0].id);
      })
      .catch(console.error);
  }, []);

  const loadPool = React.useCallback((brandId: string) => {
    setLoading(true);
    fetchCompetitorBrands(brandId)
      .then(setPool)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    if (!selectedBrandId) return;
    loadPool(selectedBrandId);
    setKeyword('');
    setResults([]);
  }, [selectedBrandId, loadPool]);

  React.useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    if (!keyword.trim()) { setResults([]); return; }
    setSearching(true);
    searchRef.current = setTimeout(() => {
      searchBrandsForPool(keyword)
        .then(setResults)
        .catch(console.error)
        .finally(() => setSearching(false));
    }, 300);
  }, [keyword]);

  const poolBrandIds = new Set(pool.map((p) => p.brand_id));

  const handleAdd = async (br: BrandSearchRow) => {
    if (!selectedBrandId || poolBrandIds.has(br.id)) return;
    setAdding(br.id);
    try {
      await addCompetitorBrand(selectedBrandId, br.id);
      loadPool(selectedBrandId);
    } catch (e) {
      console.error(e);
    } finally {
      setAdding(null);
    }
  };

  const handleRemove = async (id: string) => {
    setRemoving(id);
    try {
      await removeCompetitorBrand(id);
      setPool((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      console.error(e);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="col-flex gap-12">
      {/* 자사 브랜드 선택 */}
      <div className="row-flex gap-4" style={{ flexWrap: 'wrap' }}>
        {ownBrands.map((b) => (
          <button key={b.id} onClick={() => setSelectedBrandId(b.id)}
            style={{
              padding: '5px 14px', fontSize: 12, border: 'none', borderRadius: 20, cursor: 'pointer',
              background: selectedBrandId === b.id ? 'var(--hs)' : 'var(--snk)',
              color: selectedBrandId === b.id ? 'var(--bg)' : 'var(--f2)',
              fontWeight: selectedBrandId === b.id ? 600 : 400,
            }}>
            {b.name}
          </button>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        {/* 현재 풀 */}
        <section className="panel" style={{ padding: 0 }}>
          <div className="row-flex between center" style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
              {ownBrands.find((b) => b.id === selectedBrandId)?.name ?? '—'} 경쟁 브랜드
            </h3>
            <span className="mono dim" style={{ fontSize: 11 }}>{loading ? '…' : `${pool.length}개`}</span>
          </div>
          {loading ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>불러오는 중…</div>
          ) : pool.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
              등록된 경쟁 브랜드가 없습니다.<br />
              <span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>오른쪽에서 브랜드를 검색해 추가하세요</span>
            </div>
          ) : (
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {pool.map((b) => (
                <div key={b.id} className="row-flex between center"
                  style={{ padding: '10px 14px', borderBottom: '0.5px dashed var(--bs)' }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--f1)' }}>{b.brand_name}</span>
                    {b.corp_name && (
                      <span className="mono dim" style={{ fontSize: 11, marginLeft: 8 }}>{b.corp_name}</span>
                    )}
                  </div>
                  <button onClick={() => handleRemove(b.id)} disabled={removing === b.id}
                    className="btn sm icon" title="풀에서 제거"
                    style={{ opacity: removing === b.id ? 0.5 : 1 }}>
                    <IcX />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 브랜드 검색 + 추가 */}
        <section className="panel" style={{ padding: 0 }}>
          <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500, marginBottom: 10 }}>브랜드 검색</h3>
            <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder="브랜드명으로 검색…"
              className="input"
              style={{ width: '100%', height: 36, fontSize: 13 }} />
          </div>
          <div style={{ maxHeight: 440, overflowY: 'auto' }}>
            {searching ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>검색 중…</div>
            ) : keyword && results.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                "{keyword}"에 해당하는 브랜드가 없습니다
              </div>
            ) : (
              results.map((br) => {
                const inPool = poolBrandIds.has(br.id);
                return (
                  <div key={br.id} className="row-flex between center"
                    style={{ padding: '10px 14px', borderBottom: '0.5px dashed var(--bs)', background: inPool ? 'var(--snk)' : 'transparent' }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: inPool ? 'var(--f3)' : 'var(--f1)' }}>{br.name}</span>
                      {br.corp_name && (
                        <span className="mono dim" style={{ fontSize: 11, marginLeft: 8 }}>{br.corp_name}</span>
                      )}
                    </div>
                    {inPool ? (
                      <span style={{ fontSize: 11, color: 'var(--f4)' }}>추가됨</span>
                    ) : (
                      <button onClick={() => handleAdd(br)} disabled={adding === br.id}
                        className="btn sm" style={{ opacity: adding === br.id ? 0.5 : 1 }}>
                        <IcPlus /> 추가
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── 상품 매칭 탭 ───────────────────────────────────────────────────

type MatchFilter = 'all' | 'confirmed' | 'auto';

function MatchCard({ m, onConfirm, onExclude }: {
  m: ProductMatchRow;
  onConfirm: () => void;
  onExclude: () => void;
}) {
  const confirmed = m.status === 'confirmed';
  return (
    <div style={{
      border: `0.5px solid ${confirmed ? 'var(--hs)' : 'var(--bs)'}`,
      borderRadius: 8, padding: '10px 12px',
      background: confirmed ? 'color-mix(in srgb, var(--hs) 6%, var(--sur))' : 'var(--sur)',
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <div style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 6, overflow: 'hidden',
        background: 'var(--snk)', border: '0.5px solid var(--bs)' }}>
        {m.competitor_thumbnail && (
          <img src={m.competitor_thumbnail} alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row-flex between center" style={{ gap: 6 }}>
          <span className="chip" style={{ fontSize: 10 }}>{m.competitor_brand}</span>
          {confirmed && (
            <span className="chip" style={{ background: 'var(--hs)', color: 'var(--bg)', borderColor: 'var(--hs)', fontSize: 10 }}>확정</span>
          )}
        </div>
        <div style={{ fontSize: 13, fontWeight: confirmed ? 500 : 400, color: 'var(--f1)', marginTop: 4,
          lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {m.competitor_name}
        </div>
        <div className="row-flex gap-8" style={{ marginTop: 5 }}>
          <span className="mono dim" style={{ fontSize: 10 }}>#{m.competitor_musinsa_no}</span>
          <span className="mono dim" style={{ fontSize: 10 }}>리뷰 {m.competitor_review_count.toLocaleString()}</span>
          {m.competitor_satisfaction != null && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--hs)' }}>★{m.competitor_satisfaction}</span>
          )}
        </div>
      </div>
      <div className="col-flex gap-4" style={{ flexShrink: 0 }}>
        {!confirmed && (
          <button onClick={onConfirm} className="btn sm icon" title="경쟁 상품으로 확정"><IcCheck /></button>
        )}
        <button onClick={onExclude} className="btn sm icon" title="제외"><IcX /></button>
      </div>
    </div>
  );
}

function ProductMatching() {
  const [products, setProducts] = React.useState<OwnProduct[]>([]);
  const [loadingProds, setLoadingProds] = React.useState(true);
  const [selectedIdx, setSelectedIdx] = React.useState(0);

  const [matches, setMatches] = React.useState<ProductMatchRow[]>([]);
  const [loadingMatches, setLoadingMatches] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [runMsg, setRunMsg] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<MatchFilter>('all');

  React.useEffect(() => {
    fetchOwnProducts(100)
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoadingProds(false));
  }, []);

  const own = products[selectedIdx];

  React.useEffect(() => {
    if (!own) return;
    setMatches([]);
    setLoadingMatches(true);
    setRunMsg(null);
    fetchProductMatches(own.id)
      .then(setMatches)
      .catch(console.error)
      .finally(() => setLoadingMatches(false));
  }, [own?.id]);

  const handleAutoMatch = async () => {
    if (!own) return;
    setRunning(true);
    setRunMsg(null);
    try {
      const n = await runAutoMatch(own.id);
      setRunMsg(n > 0 ? `${n}건 후보 생성 완료` : '경쟁 브랜드 풀에 해당 카테고리 상품이 없습니다');
      const updated = await fetchProductMatches(own.id);
      setMatches(updated);
    } catch (e: any) {
      setRunMsg(`오류: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  const handleStatus = async (matchId: string, status: 'confirmed' | 'excluded') => {
    await setMatchStatus(matchId, status);
    if (status === 'excluded') {
      setMatches((prev) => prev.filter((m) => m.id !== matchId));
    } else {
      setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, status } : m));
    }
  };

  const visibleMatches = matches.filter((m) => {
    if (filter === 'confirmed') return m.status === 'confirmed';
    if (filter === 'auto') return m.status === 'auto';
    return true;
  });
  const confirmedCount = matches.filter((m) => m.status === 'confirmed').length;
  const autoCount = matches.filter((m) => m.status === 'auto').length;

  return (
    <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 14, alignItems: 'start' }}>
      {/* 자사 상품 목록 */}
      <section className="panel" style={{ padding: 0 }}>
        <div className="row-flex between center" style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--bs)' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>자사 상품</h3>
          <span className="mono dim" style={{ fontSize: 11 }}>{loadingProds ? '…' : `${products.length}건`}</span>
        </div>
        <div style={{ maxHeight: 580, overflowY: 'auto' }}>
          {loadingProds ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ padding: '12px 14px', borderBottom: '0.5px dashed var(--bs)' }}>
                <div style={{ height: 10, background: 'var(--rai)', borderRadius: 3, marginBottom: 6, width: '55%' }} />
                <div style={{ height: 13, background: 'var(--rai)', borderRadius: 3, width: '80%' }} />
              </div>
            ))
          ) : products.map((p, i) => (
            <div key={p.id} onClick={() => setSelectedIdx(i)}
              style={{
                padding: '11px 14px',
                background: selectedIdx === i ? 'var(--snk)' : 'transparent',
                borderLeft: selectedIdx === i ? '2px solid var(--hs)' : '2px solid transparent',
                borderBottom: '0.5px dashed var(--bs)', cursor: 'pointer',
              }}>
              <div className="row-flex between center" style={{ marginBottom: 2 }}>
                <span className="mono dim" style={{ fontSize: 10 }}>#{p.musinsa_no}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--f3)' }}>{p.brand_name}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: selectedIdx === i ? 500 : 400, lineHeight: 1.35,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </div>
              <div className="row-flex between center" style={{ marginTop: 5 }}>
                <span className="mono dim" style={{ fontSize: 10 }}>리뷰 {p.review_count.toLocaleString()}</span>
                {p.satisfaction_score != null && (
                  <span style={{ fontSize: 10, color: 'var(--hs)' }}>★{p.satisfaction_score}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 매칭 패널 */}
      <div className="col-flex gap-12">
        {own ? (
          <>
            <section className="panel">
              <div className="row-flex between baseline">
                <div>
                  <div className="row-flex baseline gap-8">
                    <span className="mono dim" style={{ fontSize: 12 }}>#{own.musinsa_no}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--f1)' }}>{own.name}</span>
                  </div>
                  <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
                    {own.brand_name} · 리뷰 {own.review_count.toLocaleString()}건
                    {own.satisfaction_score != null && ` · ★${own.satisfaction_score}`}
                  </div>
                </div>
                <div className="row-flex gap-8 center">
                  {runMsg && <span style={{ fontSize: 11, color: 'var(--f3)' }}>{runMsg}</span>}
                  <button onClick={handleAutoMatch} disabled={running} className="btn sm"
                    style={{ opacity: running ? 0.6 : 1 }}>
                    {running ? '실행 중…' : '자동 매칭 실행'}
                  </button>
                </div>
              </div>
            </section>

            <section className="panel" style={{ padding: 0 }}>
              <div className="row-flex between center" style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)' }}>
                <div className="row-flex gap-4">
                  {(['all', 'confirmed', 'auto'] as MatchFilter[]).map((f) => {
                    const labels: Record<MatchFilter, string> = {
                      all: `전체 ${matches.length}`,
                      confirmed: `확정 ${confirmedCount}`,
                      auto: `후보 ${autoCount}`,
                    };
                    return (
                      <button key={f} onClick={() => setFilter(f)}
                        style={{
                          padding: '3px 10px', fontSize: 12, border: 'none', borderRadius: 20, cursor: 'pointer',
                          background: filter === f ? 'var(--hs)' : 'var(--snk)',
                          color: filter === f ? 'var(--bg)' : 'var(--f3)',
                          fontWeight: filter === f ? 600 : 400,
                        }}>
                        {labels[f]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ padding: 14 }}>
                {loadingMatches ? (
                  <div style={{ textAlign: 'center', color: 'var(--f4)', fontSize: 12, padding: '24px 0' }}>불러오는 중…</div>
                ) : visibleMatches.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--f4)', fontSize: 12 }}>
                    매칭 후보가 없습니다.<br />
                    <span style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
                      경쟁 브랜드 풀을 먼저 구성한 뒤 "자동 매칭 실행"을 눌러주세요
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                    {visibleMatches.map((m) => (
                      <MatchCard key={m.id} m={m}
                        onConfirm={() => handleStatus(m.id, 'confirmed')}
                        onExclude={() => handleStatus(m.id, 'excluded')} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        ) : (
          <section className="panel">
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
              좌측에서 자사 상품을 선택하세요
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────

type Tab = 'brands' | 'products';

export default function MatchingPage() {
  const [tab, setTab] = React.useState<Tab>('brands');

  return (
    <>
      <div className="page-title">
        <h1>자사 매칭</h1>
        <span className="sub">경쟁 브랜드 풀 구성 후 자사 상품과 경쟁 상품을 매칭하세요</span>
      </div>

      <div className="row-flex gap-4" style={{ marginBottom: 14 }}>
        {([['brands', '경쟁 브랜드 풀'], ['products', '상품 매칭']] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              padding: '6px 16px', fontSize: 13, border: 'none', borderRadius: 20, cursor: 'pointer',
              background: tab === key ? 'var(--hs)' : 'var(--snk)',
              color: tab === key ? 'var(--bg)' : 'var(--f2)',
              fontWeight: tab === key ? 600 : 400,
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'brands' ? <BrandPool /> : <ProductMatching />}
    </>
  );
}
