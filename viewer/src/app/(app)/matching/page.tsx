'use client';
import { formatFiveStarRating } from '@/lib/rating-format';
import { formatMatchingScore, getMatchingGrade, MATCHING_SCORE_HELP } from '@/lib/matching-score';
import React from 'react';
import { useIsMobile } from '@/hooks/useViewport';
import { supabaseBrowser } from '@/lib/supabase/client';
import MobileMatchingView from './MobileMatchingView';
import Link from 'next/link';
import { IcArrowUR, IcCheck, IcX, IcPlus } from '@/components/ui/icons';
import {
  fetchOwnBrands, type OwnBrand,
  fetchOwnProductsWithPrices, type OwnProductWithPrice,
  fetchCompetitorBrands, addCompetitorBrand, removeCompetitorBrand,
  searchBrandsForPool, type CompetitorBrandRow, type BrandSearchRow,
  fetchProductMatches, setMatchStatus, runAutoMatch, resetAndAutoMatch, type ProductMatchRow,
  searchCompetitorProducts, addManualMatch, type CompetitorProductSearchResult,
  CATEGORY_MAP,
} from '@/lib/queries';

const CATEGORY_ENTRIES = Object.entries(CATEGORY_MAP).filter(([code]) => code !== '000');

const MATCHING_SS = 'matching-state-v1';
function readMatchingSS(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(sessionStorage.getItem(MATCHING_SS) ?? '{}'); } catch { return {}; }
}

// ── 경쟁 브랜드 풀 ─────────────────────────────────────────────────

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
  const [targetVersion, setTargetVersion] = React.useState(0);
  const [ownLoading, setOwnLoading] = React.useState(true);
  const [ownError, setOwnError] = React.useState<string | null>(null);
  const [poolError, setPoolError] = React.useState<string | null>(null);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [ownRetry, setOwnRetry] = React.useState(0);
  const [searchVersion, setSearchVersion] = React.useState(0);
  const [auth, setAuth] = React.useState({ ready: false, userId: null as string | null, epoch: 0 });
  const identity = React.useRef(auth);
  const mounted = React.useRef(false);
  const target = React.useRef({ brandId: null as string | null, version: 0 });
  const poolRequest = React.useRef(0);
  const searchRequest = React.useRef(0);
  const keywordRef = React.useRef('');
  const mutation = React.useRef<object | null>(null);
  const scope = () => ({ ...target.current, epoch: identity.current.epoch });
  const current = React.useCallback((s: { brandId: string | null; version: number; epoch: number }) =>
    mounted.current && identity.current.userId !== null && identity.current.epoch === s.epoch &&
    target.current.version === s.version && target.current.brandId === s.brandId, []);

  const selectBrand = React.useCallback((brandId: string | null) => {
    if (brandId && target.current.brandId === brandId) return;
    target.current = { brandId, version: target.current.version + 1 };
    setTargetVersion(target.current.version);
    poolRequest.current += 1; searchRequest.current += 1; keywordRef.current = '';
    setSelectedBrandId(brandId); setPool([]); setPoolError(null); setLoading(!!brandId);
    setKeyword(''); setResults([]); setSearching(false); setSearchError(null); setActionError(null);
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const { data: { subscription } } = supabaseBrowser().auth.onAuthStateChange((_event, session) => {
      if (cancelled || !mounted.current) return;
      const userId = session?.user.id ?? null;
      if (identity.current.ready && identity.current.userId === userId) return;
      identity.current = { ready: true, userId, epoch: identity.current.epoch + 1 };
      selectBrand(null); setOwnBrands([]); setOwnError(null); setOwnLoading(!!userId);
      mutation.current = null; setBusy(false); setAdding(null); setRemoving(null);
      setAuth(identity.current);
    });
    return () => {
      cancelled = true; mounted.current = false; poolRequest.current += 1; searchRequest.current += 1;
      subscription.unsubscribe();
    };
  }, [selectBrand]);

  React.useEffect(() => {
    if (!auth.ready || !auth.userId) return;
    let cancelled = false;
    const epoch = auth.epoch;
    const active = () => !cancelled && mounted.current && identity.current.epoch === epoch;
    setOwnLoading(true); setOwnError(null);
    fetchOwnBrands().then(brands => {
      if (!active()) return;
      if (!Array.isArray(brands) || brands.some(b => !b || typeof b.id !== 'string' || typeof b.name !== 'string')) throw new Error('Invalid brands');
      setOwnBrands(brands); selectBrand(brands[0]?.id ?? null);
    }).catch(() => { if (active()) setOwnError('자사 브랜드 목록을 불러오지 못했습니다.'); })
      .finally(() => { if (active()) setOwnLoading(false); });
    return () => { cancelled = true; };
  }, [auth.ready, auth.userId, auth.epoch, ownRetry, selectBrand]);

  const loadPool = React.useCallback(async (s: { brandId: string | null; version: number; epoch: number }) => {
    if (!s.brandId || !current(s)) return;
    const request = ++poolRequest.current;
    const active = () => current(s) && request === poolRequest.current;
    setLoading(true); setPool([]); setPoolError(null);
    try {
      const rows = await fetchCompetitorBrands(s.brandId);
      if (!active()) return;
      if (!Array.isArray(rows) || rows.some(r => !r || typeof r.id !== 'string' || r.own_brand_id !== s.brandId ||
        typeof r.brand_id !== 'string' || typeof r.brand_name !== 'string' || typeof r.added_at !== 'string')) throw new Error('Invalid pool');
      setPool(rows);
    } catch { if (active()) setPoolError('경쟁 브랜드 풀을 불러오지 못했습니다.'); }
    finally { if (active()) setLoading(false); }
  }, [current]);

  React.useEffect(() => {
    if (!selectedBrandId) return;
    void loadPool({ brandId: selectedBrandId, version: target.current.version, epoch: auth.epoch });
    return () => { poolRequest.current += 1; };
  }, [selectedBrandId, targetVersion, auth.epoch, loadPool]);

  const changeKeyword = (value: string) => {
    if (keywordRef.current === value) return;
    setSearchVersion(n => n + 1);
    searchRequest.current += 1; keywordRef.current = value;
    setKeyword(value); setResults([]); setSearchError(null); setSearching(!!value.trim());
  };
  React.useEffect(() => {
    const s = { brandId: selectedBrandId, version: target.current.version, epoch: auth.epoch };
    if (!keyword.trim() || !s.brandId || !current(s)) return;
    const request = ++searchRequest.current;
    const active = () => current(s) && request === searchRequest.current && keywordRef.current === keyword;
    setSearching(true); setResults([]); setSearchError(null);
    const timer = setTimeout(async () => {
      try {
        const rows = await searchBrandsForPool(keyword);
        if (!active()) return;
        if (!Array.isArray(rows) || rows.some(r => !r || typeof r.id !== 'string' || typeof r.name !== 'string')) throw new Error('Invalid search');
        setResults(rows);
      } catch { if (active()) setSearchError('브랜드 검색 결과를 불러오지 못했습니다.'); }
      finally { if (active()) setSearching(false); }
    }, 300);
    return () => { clearTimeout(timer); searchRequest.current += 1; };
  }, [keyword, selectedBrandId, targetVersion, auth.epoch, searchVersion, current]);

  const poolBrandIds = new Set(pool.map(p => p.brand_id));
  const selectedBrandName = ownBrands.find(b => b.id === selectedBrandId)?.name ?? '—';
  // Capture the rendered scope too: retained buttons from an old view cannot write.
  const renderedScope = scope();
  const renderedSearch = searchRequest.current;
  const runAction = async (action: () => Promise<void>, id: string, kind: 'add' | 'remove') => {
    if (!current(renderedScope) || !selectedBrandId || loading || poolError || mutation.current) return;
    const operation = {};
    mutation.current = operation; setBusy(true); setActionError(null);
    if (kind === 'add') setAdding(id); else setRemoving(id);
    try {
      await action();
      // A completion may refresh a reselected A, but never B or another account.
      if (mounted.current && identity.current.epoch === renderedScope.epoch && target.current.brandId === selectedBrandId) {
        await loadPool(scope());
      }
    } catch {
      if (current(renderedScope)) setActionError(kind === 'add' ? '브랜드를 추가하지 못했습니다.' : '브랜드를 제거하지 못했습니다.');
    } finally {
      if (mounted.current && mutation.current === operation) {
        mutation.current = null; setBusy(false); setAdding(null); setRemoving(null);
      }
    }
  };
  const handleAdd = (br: BrandSearchRow) => {
    if (renderedSearch !== searchRequest.current || searching || searchError || !results.some(r => r.id === br.id) || poolBrandIds.has(br.id)) return;
    return runAction(() => addCompetitorBrand(selectedBrandId!, br.id), br.id, 'add');
  };
  const handleRemove = (id: string) => {
    if (!pool.some(r => r.id === id)) return;
    return runAction(() => removeCompetitorBrand(id), id, 'remove');
  };

  const brandChipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', borderRadius: 20,
    border: '0.5px solid var(--bs)', background: 'var(--snk)',
    fontSize: 12, fontWeight: 500, color: 'var(--f1)',
    cursor: 'pointer', textDecoration: 'none',
    transition: 'background 0.15s',
  };
  const corpChipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center',
    padding: '2px 7px', borderRadius: 20,
    border: '0.5px solid var(--bs)', background: 'transparent',
    fontSize: 11, color: 'var(--f3)', whiteSpace: 'nowrap',
  };

  return (
    <div className="col-flex gap-12">
      {/* 자사 브랜드 선택 + 경쟁 브랜드 검색 (항상 열림) */}
      <section className="panel" style={{ padding: '12px 14px' }}>
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>자사 브랜드 선택</h3>
          {ownLoading && <div className="dim" style={{ fontSize: 12 }}>자사 브랜드 불러오는 중…</div>}
          {ownError && <div role="alert" style={{ color: 'var(--grade-dn)', fontSize: 12 }}>{ownError} <button className="btn sm" onClick={() => { if (current(renderedScope)) setOwnRetry(n => n + 1); }}>자사 브랜드 다시 시도</button></div>}
          {!ownLoading && !ownError && ownBrands.length === 0 && <div className="dim" style={{ fontSize: 12 }}>{auth.userId ? '자사 브랜드가 없습니다.' : '로그인 후 브랜드 풀을 확인하세요.'}</div>}
          <div className="row-flex gap-4" style={{ flexWrap: 'wrap' }}>
            {ownBrands.map(b => (
              <button key={b.id} onClick={() => { if (mounted.current && identity.current.epoch === renderedScope.epoch) selectBrand(b.id); }}
                className={`btn sm ${selectedBrandId === b.id ? 'active' : ''}`}
                style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>
                {b.name}
              </button>
            ))}
          </div>
        </div>

        {/* 브랜드 검색 (항상 표시) */}
        <div style={{ borderTop: '0.5px solid var(--bs)', paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, marginBottom: 6 }}>
            경쟁 브랜드 추가 — <span style={{ color: 'var(--hs)' }}>{selectedBrandName}</span> 풀에 추가
          </div>
          <input
            type="text" value={keyword} disabled={!selectedBrandId} onChange={e => { if (current(renderedScope)) changeKeyword(e.target.value); }}
            placeholder="브랜드 검색…"
            style={{
              width: '100%', fontFamily: 'var(--sans)', fontSize: 12, padding: '6px 10px',
              border: '0.5px solid var(--bs)', borderRadius: 5,
              background: 'var(--bg)', color: 'var(--f1)', boxSizing: 'border-box',
            }} />
          {searching && (
            <div style={{ padding: '10px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>검색 중…</div>
          )}
          {searchError && <div role="alert" style={{ padding: '10px 0', color: 'var(--grade-dn)', fontSize: 12 }}>{searchError} <button className="btn sm" onClick={() => { if (current(renderedScope) && renderedSearch === searchRequest.current && keywordRef.current === keyword) { searchRequest.current += 1; setSearchVersion(n => n + 1); } }}>검색 다시 시도</button></div>}
          {!searching && !searchError && keyword.trim() && results.length === 0 && (
            <div style={{ padding: '10px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
              "{keyword}"에 해당하는 브랜드가 없습니다
            </div>
          )}
          {!searching && results.length > 0 && (
            <div style={{
              marginTop: 8, border: '0.5px solid var(--bs)', borderRadius: 5,
              overflow: 'hidden', maxHeight: 280, overflowY: 'auto',
            }}>
              {results.map(br => {
                const inPool = poolBrandIds.has(br.id);
                return (
                  <div key={br.id} className="row-flex between center"
                    style={{
                      padding: '9px 12px', borderBottom: '0.5px solid var(--bs)',
                      background: inPool ? 'var(--snk)' : undefined,
                    }}>
                    <div className="row-flex center gap-8">
                      {br.slug ? (
                        <a href={`https://www.musinsa.com/brands/${br.slug}`}
                          target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ ...brandChipStyle, color: inPool ? 'var(--f3)' : 'var(--f1)', background: inPool ? 'var(--snk)' : 'var(--sur)' }}>
                          {br.name} <IcArrowUR size={9} />
                        </a>
                      ) : (
                        <span style={{ ...brandChipStyle, cursor: 'default', color: inPool ? 'var(--f3)' : 'var(--f1)' }}>
                          {br.name}
                        </span>
                      )}
                      {br.corp_name && (
                        <span style={corpChipStyle}>{br.corp_name}</span>
                      )}
                    </div>
                    {inPool ? (
                      <span style={{ fontSize: 11, color: 'var(--f4)' }}>추가됨</span>
                    ) : (
                      <button onClick={() => handleAdd(br)} disabled={busy || loading || !!poolError}
                        className="btn sm" style={{ opacity: adding === br.id ? 0.5 : 1 }}>
                        <IcPlus size={11} /> 추가
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 경쟁 브랜드 풀 목록 */}
      <section className="panel" style={{ padding: 0 }}>
        <div className="row-flex between center"
          style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)', background: 'var(--snk)' }}>
          <div className="row-flex center gap-8">
            <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedBrandName}</span>
            <span style={{ fontSize: 12, color: 'var(--f3)' }}>경쟁 브랜드 풀</span>
          </div>
          <span className="mono dim" style={{ fontSize: 11 }}>
            {loading ? '…' : poolError ? '—' : `${pool.length}개`}
          </span>
        </div>

        {actionError && <div role="alert" style={{ padding: '10px 14px', color: 'var(--grade-dn)', fontSize: 12 }}>{actionError}</div>}
        {poolError ? (
          <div role="alert" style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--grade-dn)', fontSize: 12 }}>
            {poolError} <button className="btn sm" onClick={() => { if (current(renderedScope)) void loadPool(renderedScope); }}>풀 다시 시도</button>
          </div>
        ) : !selectedBrandId ? (
          <div className="dim" style={{ padding: '32px 14px', textAlign: 'center', fontSize: 12 }}>자사 브랜드를 선택하세요.</div>
        ) : loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>불러오는 중…</div>
        ) : pool.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
            등록된 경쟁 브랜드가 없습니다<br />
            <span style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
              위 검색창에서 브랜드를 검색해 추가하세요
            </span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%', minWidth: 900, borderCollapse: 'collapse',
              fontSize: 11, color: 'var(--f1)',
            }}>
              <thead>
                <tr style={{ background: 'var(--snk)', borderBottom: '0.5px solid var(--bs)' }}>
                  {[
                    ['No.', 32, 'center'],
                    ['브랜드', 190, 'left'],
                    ['국가·설립', 90, 'center'],
                    ['회사', 140, 'left'],
                    ['대표·상장', 110, 'left'],
                    ['무신사순위', 72, 'center'],
                    ['매출(억/조)', 105, 'right'],
                    ['영업이익', 95, 'right'],
                    ['추가일', 80, 'center'],
                    ['', 36, 'center'],
                  ].map(([label, width, align]) => (
                    <th key={String(label)} style={{
                      padding: '7px 10px', fontWeight: 600, fontSize: 10,
                      color: 'var(--f3)', textAlign: align as React.CSSProperties['textAlign'],
                      whiteSpace: 'nowrap', minWidth: Number(width),
                    }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pool.map((b, idx) => {
                  const revAeok = b.revenue != null ? Math.round(b.revenue / 100_000_000) : null;
                  const opAeok = b.operating_income != null ? Math.round(b.operating_income / 100_000_000) : null;
                  const fmtWon = (v: number | null) => {
                    if (v == null) return '—';
                    if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}조`;
                    return `${v.toLocaleString()}억`;
                  };
                  return (
                    <tr key={b.id} style={{
                      borderBottom: '0.5px solid var(--bs)',
                      background: idx % 2 === 1 ? 'var(--snk)' : undefined,
                    }}>
                      {/* No. */}
                      <td style={{ padding: '9px 10px', textAlign: 'center', color: 'var(--f4)', fontSize: 10 }}>
                        {idx + 1}
                      </td>
                      {/* 브랜드 */}
                      <td style={{ padding: '9px 10px' }}>
                        <div>
                          <div className="row-flex center gap-4">
                            <Link href={`/brand?id=${b.brand_id}`}
                              style={{ ...brandChipStyle, fontSize: 11 }}>
                              {b.brand_name}
                            </Link>
                            {b.slug && (
                              <a href={`https://www.musinsa.com/brands/${b.slug}`}
                                target="_blank" rel="noopener noreferrer"
                                style={{ color: 'var(--f4)', flexShrink: 0 }} title="무신사에서 보기">
                                <IcArrowUR size={9} />
                              </a>
                            )}
                          </div>
                          {b.name_eng && (
                            <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 3, fontStyle: 'italic' }}>
                              {b.name_eng}
                            </div>
                          )}
                        </div>
                      </td>
                      {/* 국가·설립 */}
                      <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: 'var(--f2)' }}>{b.nation_name ?? '—'}</div>
                        {b.since_year && (
                          <div className="mono dim" style={{ fontSize: 10 }}>est. {b.since_year}</div>
                        )}
                      </td>
                      {/* 회사 */}
                      <td style={{ padding: '9px 10px' }}>
                        {b.corp_name && b.company_id ? (
                          <div className="row-flex center gap-4" style={{ flexWrap: 'nowrap' }}>
                            <Link href={`/company?id=${b.company_id}`}
                              style={{ fontSize: 11, color: 'var(--hs)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
                              {b.corp_name}
                            </Link>
                            {b.website && (
                              <a href={b.website} target="_blank" rel="noopener noreferrer"
                                style={{ color: 'var(--f4)', flexShrink: 0 }} title="웹사이트">
                                <IcArrowUR size={9} />
                              </a>
                            )}
                          </div>
                        ) : b.corp_name ? (
                          <span style={{ fontSize: 11, color: 'var(--f2)' }}>{b.corp_name}</span>
                        ) : <span style={{ color: 'var(--f4)' }}>—</span>}
                      </td>
                      {/* 대표·상장 */}
                      <td style={{ padding: '9px 10px' }}>
                        <div style={{ fontSize: 10, color: 'var(--f2)' }}>
                          {b.ceo_name ? `${b.ceo_name}` : '—'}
                        </div>
                        {b.is_listed && (
                          <span className="chip" style={{
                            fontSize: 9, background: 'color-mix(in srgb, var(--hs) 10%, transparent)',
                            color: 'var(--hs)', borderColor: 'var(--hs)', marginTop: 2, display: 'inline-block',
                          }}>
                            상장
                          </span>
                        )}
                      </td>
                      {/* 무신사 순위 */}
                      <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                        {b.brand_rank != null ? (
                          <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--hs)' }}>
                            #{b.brand_rank}
                          </span>
                        ) : <span style={{ color: 'var(--f4)' }}>—</span>}
                      </td>
                      {/* 매출 */}
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                        <span className="mono" style={{ fontSize: 11, color: revAeok != null ? 'var(--f1)' : 'var(--f4)', fontWeight: revAeok != null ? 500 : 400 }}>
                          {fmtWon(revAeok)}
                        </span>
                        {b.fiscal_year && revAeok != null && (
                          <div className="mono dim" style={{ fontSize: 9 }}>{b.fiscal_year}년</div>
                        )}
                      </td>
                      {/* 영업이익 */}
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                        <span className="mono" style={{
                          fontSize: 11,
                          color: opAeok == null ? 'var(--f4)' : opAeok >= 0 ? 'var(--f2)' : 'var(--grade-dn)',
                        }}>
                          {fmtWon(opAeok)}
                        </span>
                      </td>
                      {/* 추가일 */}
                      <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                        <span className="mono dim" style={{ fontSize: 10 }}>{b.added_at.slice(0, 10)}</span>
                      </td>
                      {/* 제거 */}
                      <td style={{ padding: '9px 6px', textAlign: 'center' }}>
                        <button onClick={() => handleRemove(b.id)} disabled={busy}
                          className="btn sm icon" title="풀에서 제거"
                          style={{ opacity: removing === b.id ? 0.5 : 1 }}>
                          <IcX />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── 상품 매칭 ─────────────────────────────────────────────────────

type MatchFilter = 'all' | 'confirmed' | 'a' | 'b';

function MatchCard({ m, onConfirm, onExclude, disabled }: {
  m: ProductMatchRow;
  onConfirm: () => void;
  onExclude: () => void;
  disabled?: boolean;
}) {
  const confirmed = m.status === 'confirmed';
  const isAuto = m.status === 'auto';
  const grade = getMatchingGrade(m.status, m.score);
  const gradeA = grade === 'A';
  const gradeB = grade === 'B';

  return (
    <div style={{
      border: `0.5px solid ${confirmed ? 'var(--hs)' : gradeA ? 'color-mix(in srgb, var(--grade-a) 40%, var(--bs))' : 'var(--bs)'}`,
      borderRadius: 7, padding: '10px 12px',
      background: confirmed
        ? 'color-mix(in srgb, var(--hs) 6%, var(--sur))'
        : gradeA ? 'color-mix(in srgb, var(--grade-a) 4%, var(--sur))'
        : 'var(--sur)',
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <div style={{
        width: 48, height: 48, flexShrink: 0, borderRadius: 5,
        overflow: 'hidden', background: 'var(--snk)', border: '0.5px solid var(--bs)',
      }}>
        {m.competitor_thumbnail && (
          <img src={m.competitor_thumbnail} alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row-flex center gap-4" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
          <span className="chip" style={{ fontSize: 10 }}>{m.competitor_brand}</span>
          {confirmed && (
            <span className="chip" style={{
              background: 'var(--hs)', color: 'var(--bg)', borderColor: 'var(--hs)', fontSize: 10,
            }}>확정</span>
          )}
          {gradeA && (
            <span className="chip" style={{
              background: 'var(--grade-a)', color: 'var(--white)', borderColor: 'var(--grade-a)', fontSize: 10, fontWeight: 700,
            }}>A</span>
          )}
          {gradeB && (
            <span className="chip" style={{
              background: 'color-mix(in srgb, var(--grade-b) 15%, var(--bg))', color: 'var(--grade-b)',
              borderColor: 'var(--grade-b)', fontSize: 10, fontWeight: 700,
            }}>B</span>
          )}
          {isAuto && (
            <span className="mono" style={{ fontSize: 10, color: gradeA ? 'var(--grade-a)' : gradeB ? 'var(--grade-b)' : 'var(--f4)' }}>
              {formatMatchingScore(m.score)}
            </span>
          )}
        </div>
        <a href={`https://www.musinsa.com/products/${m.competitor_musinsa_no}`}
          target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          <div style={{
            fontSize: 13, fontWeight: confirmed ? 500 : 400, color: 'var(--f1)',
            lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {m.competitor_name}
          </div>
        </a>
        <div className="row-flex gap-8" style={{ marginTop: 5 }}>
          <span className="mono dim" style={{ fontSize: 10 }}>#{m.competitor_musinsa_no}</span>
          <span className="mono dim" style={{ fontSize: 10 }}>리뷰 {m.competitor_review_count.toLocaleString()}</span>
          {m.competitor_satisfaction != null && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--hs)' }}>{formatFiveStarRating(m.competitor_satisfaction)}</span>
          )}
          {m.competitor_category && (
            <span className="mono dim" style={{ fontSize: 10 }}>
              {CATEGORY_MAP[m.competitor_category] ?? m.competitor_category}
            </span>
          )}
        </div>
      </div>
      <div className="col-flex gap-4" style={{ flexShrink: 0 }}>
        {!confirmed && (
          <button onClick={onConfirm} disabled={disabled} className="btn sm icon" title="경쟁 상품으로 확정"><IcCheck /></button>
        )}
        <button onClick={onExclude} disabled={disabled} className="btn sm icon" title="제외"><IcX /></button>
      </div>
    </div>
  );
}

function ProductMatching() {
  const ss = React.useRef(readMatchingSS());

  // ── 필터 상태 ──
  const [ownBrands, setOwnBrands] = React.useState<OwnBrand[]>([]);
  const [filterBrandIds, setFilterBrandIds] = React.useState<Set<string>>(new Set((ss.current.filterBrandIds as string[]) ?? []));
  const [filterGender, setFilterGender] = React.useState((ss.current.filterGender as string) ?? '');
  const [filterCategory, setFilterCategory] = React.useState((ss.current.filterCategory as string) ?? '');
  const [filterKwInput, setFilterKwInput] = React.useState((ss.current.filterKwInput as string) ?? '');
  const [filterKeyword, setFilterKeyword] = React.useState((ss.current.filterKeyword as string) ?? '');
  const [minPrice, setMinPrice] = React.useState((ss.current.minPrice as string) ?? '');
  const [maxPrice, setMaxPrice] = React.useState((ss.current.maxPrice as string) ?? '');
  const [productPage, setProductPage] = React.useState(0);

  // ── 상품 목록 ──
  const [products, setProducts] = React.useState<OwnProductWithPrice[]>([]);
  const [productTotal, setProductTotal] = React.useState(0);
  const [loadingProds, setLoadingProds] = React.useState(true);

  // ── 선택 상품 ──
  const [selectedProduct, setSelectedProduct] = React.useState<OwnProductWithPrice | null>(null);
  const [matches, setMatches] = React.useState<ProductMatchRow[]>([]);
  const [loadingMatches, setLoadingMatches] = React.useState(false);

  // ── 매칭 관리 ──
  const [running, setRunning] = React.useState(false);
  const [runMsg, setRunMsg] = React.useState<string | null>(null);
  const [matchFilter, setMatchFilter] = React.useState<MatchFilter>((ss.current.matchFilter as MatchFilter) ?? 'all');

  React.useEffect(() => {
    sessionStorage.setItem(MATCHING_SS, JSON.stringify({
      filterBrandIds: [...filterBrandIds], filterGender, filterCategory,
      filterKwInput, filterKeyword, minPrice, maxPrice, matchFilter,
    }));
  }, [filterBrandIds, filterGender, filterCategory, filterKwInput, filterKeyword, minPrice, maxPrice, matchFilter]);

  // ── 경쟁 상품 검색 ──
  const [compKw, setCompKw] = React.useState('');
  const [compResults, setCompResults] = React.useState<CompetitorProductSearchResult[]>([]);
  const [compSearching, setCompSearching] = React.useState(false);
  const [addingComp, setAddingComp] = React.useState<string | null>(null);
  const compSearchRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutationBusy = React.useRef(false);
  const selectionVersion = React.useRef(0);
  const matchReadVersion = React.useRef(0);
  const mounted = React.useRef(true);
  const selectedId = React.useRef<string | null>(null);
  const [auth, setAuth] = React.useState({ ready: false, userId: null as string | null, epoch: 0 });
  const identity = React.useRef(auth);
  const [listErrors, setListErrors] = React.useState<{ brands: string | null; products: string | null }>({ brands: null, products: null });
  React.useEffect(() => {
    mounted.current = true;
    const { data: { subscription } } = supabaseBrowser().auth.onAuthStateChange((_event, session) => {
      if (!mounted.current) return;
      const userId = session?.user.id ?? null;
      if (identity.current.ready && identity.current.userId === userId) return;
      const changed = identity.current.ready;
      identity.current = { ready: true, userId, epoch: identity.current.epoch + (changed ? 1 : 0) };
      if (changed) {
        selectionVersion.current += 1;
        selectedId.current = null;
        setSelectedProduct(null); setMatches([]); setRunMsg(null);
        setCompKw(''); setCompResults([]); setProducts([]); setProductTotal(0); setOwnBrands([]);
        setFilterBrandIds(new Set()); setProductPage(0);
        setListErrors({ brands: null, products: null });
      }
      setAuth(identity.current);
    });
    return () => { mounted.current = false; subscription.unsubscribe(); };
  }, []);

  const PROD_SIZE = 50;

  React.useEffect(() => {
    if (!auth.ready || !auth.userId) return;
    let cancelled = false;
    const epoch = auth.epoch;
    const current = () => !cancelled && mounted.current && epoch === identity.current.epoch;
    setListErrors(prev => ({ ...prev, brands: null }));
    fetchOwnBrands()
      .then(rows => { if (current()) setOwnBrands(rows); })
      .catch(() => { if (current()) setListErrors(prev => ({ ...prev, brands: '오류: 자사 브랜드 목록을 불러오지 못했습니다.' })); });
    return () => { cancelled = true; };
  }, [auth.ready, auth.userId, auth.epoch]);

  React.useEffect(() => {
    if (!auth.ready) { setLoadingProds(true); return; }
    if (!auth.userId) { setProducts([]); setProductTotal(0); setLoadingProds(false); return; }
    let cancelled = false;
    const epoch = auth.epoch;
    const current = () => !cancelled && mounted.current && epoch === identity.current.epoch;
    setLoadingProds(true);
    setListErrors(prev => ({ ...prev, products: null }));
    fetchOwnProductsWithPrices({
      brandIds: filterBrandIds.size > 0 ? [...filterBrandIds] : undefined,
      categoryCodes: filterCategory ? [filterCategory] : undefined,
      gender: filterGender || undefined,
      keyword: filterKeyword || undefined,
      limit: PROD_SIZE,
      offset: productPage * PROD_SIZE,
    }).then(({ rows, total }) => {
      if (!current()) return;
      setProducts(rows); setProductTotal(total);
    }).catch(() => {
      if (current()) {
        setProducts([]); setProductTotal(0);
        setListErrors(prev => ({ ...prev, products: '오류: 자사 상품 목록을 불러오지 못했습니다.' }));
      }
    }).finally(() => { if (current()) setLoadingProds(false); });
    return () => { cancelled = true; };
  }, [auth.ready, auth.userId, auth.epoch, filterBrandIds, filterGender, filterCategory, filterKeyword, productPage]);

  // 가격 클라이언트 필터
  const displayedProducts = React.useMemo(() => {
    let rows = products;
    const min = minPrice ? parseInt(minPrice) : null;
    const max = maxPrice ? parseInt(maxPrice) : null;
    if (min || max) {
      rows = rows.filter(p => {
        const price = p.final_price ?? p.list_price;
        if (!price) return !min;
        if (min && price < min) return false;
        if (max && price > max) return false;
        return true;
      });
    }
    return rows;
  }, [products, minPrice, maxPrice]);

  // Ignore responses for a previous selection (including A → B → A).
  React.useEffect(() => {
    if (!selectedProduct) { setMatches([]); setLoadingMatches(false); return; }
    let cancelled = false;
    const version = selectionVersion.current;
    const readVersion = ++matchReadVersion.current;
    const epoch = identity.current.epoch;
    const current = () => !cancelled && mounted.current && epoch === identity.current.epoch && version === selectionVersion.current && readVersion === matchReadVersion.current;
    setLoadingMatches(true);
    fetchProductMatches(selectedProduct.id)
      .then(rows => { if (current()) setMatches(rows); })
      .catch(() => { if (current()) setRunMsg('오류: 매칭 목록을 불러오지 못했습니다.'); })
      .finally(() => { if (current()) setLoadingMatches(false); });
    return () => { cancelled = true; };
  }, [selectedProduct]);

  // Cancel selection/account-scoped search responses as well.
  React.useEffect(() => {
    if (compSearchRef.current) clearTimeout(compSearchRef.current);
    if (!compKw.trim()) { setCompResults([]); setCompSearching(false); return; }
    let cancelled = false;
    const version = selectionVersion.current;
    const epoch = identity.current.epoch;
    const current = () => !cancelled && mounted.current && epoch === identity.current.epoch && version === selectionVersion.current;
    setCompSearching(true);
    compSearchRef.current = setTimeout(() => {
      searchCompetitorProducts(compKw)
        .then(rows => { if (current()) setCompResults(rows); })
        .catch(() => { if (current()) setRunMsg('오류: 경쟁 상품 검색을 완료하지 못했습니다.'); })
        .finally(() => { if (current()) setCompSearching(false); });
    }, 300);
    return () => { cancelled = true; if (compSearchRef.current) clearTimeout(compSearchRef.current); };
  }, [compKw]);

  // ── derived ──
  const confirmedCount = matches.filter(m => m.status === 'confirmed').length;
  const aCount = matches.filter(m => getMatchingGrade(m.status, m.score) === 'A').length;
  const bCount = matches.filter(m => getMatchingGrade(m.status, m.score) === 'B').length;
  const visibleMatches = matches.filter(m => {
    if (matchFilter === 'confirmed') return m.status === 'confirmed';
    if (matchFilter === 'a') return getMatchingGrade(m.status, m.score) === 'A';
    if (matchFilter === 'b') return getMatchingGrade(m.status, m.score) === 'B';
    return true;
  });
  const alreadyMatchedIds = new Set(matches.map(m => m.competitor_product_id));

  // ── handlers ──
  const beginMutation = () => {
    if (!selectedProduct || mutationBusy.current || loadingMatches
      || !identity.current.ready || !identity.current.userId) return null;
    mutationBusy.current = true;
    setRunning(true); setRunMsg(null);
    const productId = selectedProduct.id;
    const epoch = identity.current.epoch;
    return {
      productId,
      // Returning to A still requires reconciliation of A's outstanding mutation.
      current: () => mounted.current && epoch === identity.current.epoch && selectedId.current === productId,
    };
  };
  const finishMutation = () => {
    mutationBusy.current = false;
    if (mounted.current) { setRunning(false); setAddingComp(null); }
  };
  const failureMessage = '오류: 매칭 작업을 완료하지 못했습니다. 결과를 확인한 후 다시 실행하세요.';
  const reconcileMutation = async (action: { productId: string; current: () => boolean }, message: string | null, filter?: MatchFilter) => {
    if (!action.current()) return;
    // Invalidate a selection read started before this mutation settled.
    const version = selectionVersion.current;
    const readVersion = ++matchReadVersion.current;
    const current = () => action.current() && version === selectionVersion.current && readVersion === matchReadVersion.current;
    setLoadingMatches(true);
    if (message === failureMessage) setRunMsg(message);
    try {
      const updated = await fetchProductMatches(action.productId);
      if (!current()) {
        if (action.current() && message === failureMessage) setRunMsg(message);
        return;
      }
      setMatches(updated); setRunMsg(message);
      if (filter) setMatchFilter(filter);
    } catch { if (action.current()) setRunMsg(failureMessage); }
    finally { if (current()) setLoadingMatches(false); }
  };

  const handleAutoMatch = async (resetExcluded = false) => {
    const action = beginMutation();
    if (!action) return;
    try {
      const n = resetExcluded
        ? await resetAndAutoMatch(action.productId)
        : await runAutoMatch(action.productId);
      await reconcileMutation(action, n > 0 ? `${n}건 후보 생성 완료` : n < 0 ? `allExcluded:${-n}` : 'none', n > 0 ? 'a' : undefined);
    } catch { await reconcileMutation(action, failureMessage); }
    finally { finishMutation(); }
  };

  const handleStatus = async (matchId: string, status: 'confirmed' | 'excluded') => {
    const action = beginMutation();
    if (!action) return;
    try {
      await setMatchStatus(matchId, status);
      await reconcileMutation(action, null);
    } catch { await reconcileMutation(action, failureMessage); }
    finally { finishMutation(); }
  };

  const handleAddCompetitor = async (compProductId: string) => {
    const action = beginMutation();
    if (!action) return;
    setAddingComp(compProductId);
    try {
      await addManualMatch(action.productId, compProductId);
      await reconcileMutation(action, null, 'confirmed');
    } catch { await reconcileMutation(action, failureMessage); }
    finally { finishMutation(); }
  };

  const selectProduct = (p: OwnProductWithPrice) => {
    selectionVersion.current += 1;
    selectedId.current = selectedId.current === p.id ? null : p.id;
    setSelectedProduct(selectedId.current ? p : null);
    setMatches([]); setLoadingMatches(true);
    setMatchFilter('all');
    setCompKw('');
    setCompResults([]);
    setRunMsg(null);
  };

  const toggleBrand = (id: string) => {
    setFilterBrandIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setProductPage(0);
  };

  const resetFilters = () => {
    setFilterBrandIds(new Set()); setFilterGender(''); setFilterCategory('');
    setFilterKwInput(''); setFilterKeyword('');
    setMinPrice(''); setMaxPrice('');
    setProductPage(0);
  };

  const filterActive = filterBrandIds.size > 0 || filterGender || filterCategory || filterKeyword || minPrice || maxPrice;

  const fmtVal = (n: number | null, type: 'price' | 'pct') => {
    if (n == null) return '—';
    return type === 'price' ? n.toLocaleString() + '원' : `${n.toFixed(0)}%`;
  };

  return (
    <>
      {/* ─── 상단 필터 바 ─── */}
      <section className="panel" style={{ padding: '10px 14px', marginBottom: 14 }}>
        <div className="row-flex center gap-6" style={{ flexWrap: 'wrap' }}>
          {/* 브랜드 */}
          <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, flexShrink: 0 }}>브랜드</span>
          {ownBrands.map(b => (
            <button key={b.id}
              className={`btn sm ${filterBrandIds.has(b.id) ? 'active' : ''}`}
              onClick={() => toggleBrand(b.id)}
              style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
              {b.name}
            </button>
          ))}
          <div style={{ width: 1, background: 'var(--bs)', alignSelf: 'stretch', margin: '0 2px' }} />

          {/* 성별 */}
          <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, flexShrink: 0 }}>성별</span>
          {([['', '전체'], ['M', '남성'], ['F', '여성'], ['A', '유니섹스']] as [string, string][]).map(([val, label]) => (
            <button key={val}
              className={`btn sm ${filterGender === val ? 'active' : ''}`}
              onClick={() => { setFilterGender(val); setProductPage(0); }}
              style={{ fontSize: 11 }}>
              {label}
            </button>
          ))}
          <div style={{ width: 1, background: 'var(--bs)', alignSelf: 'stretch', margin: '0 2px' }} />

          {/* 카테고리 */}
          <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, flexShrink: 0 }}>카테고리</span>
          <select
            value={filterCategory}
            onChange={e => { setFilterCategory(e.target.value); setProductPage(0); }}
            style={{
              fontFamily: 'var(--sans)', fontSize: 11, padding: '3px 6px',
              border: '0.5px solid var(--bs)', borderRadius: 5,
              background: filterCategory ? 'color-mix(in srgb, var(--hs) 12%, var(--bg))' : 'var(--bg)',
              color: filterCategory ? 'var(--hs)' : 'var(--f2)',
            }}>
            <option value="">전체</option>
            {CATEGORY_ENTRIES.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          <div style={{ width: 1, background: 'var(--bs)', alignSelf: 'stretch', margin: '0 2px' }} />

          {/* 가격 */}
          <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500, flexShrink: 0 }}>가격</span>
          <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="최소"
            style={{ width: 68, fontFamily: 'var(--sans)', fontSize: 11, padding: '3px 6px', border: '0.5px solid var(--bs)', borderRadius: 5, background: 'var(--bg)', color: 'var(--f1)' }} />
          <span style={{ fontSize: 11, color: 'var(--f4)' }}>~</span>
          <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="최대"
            style={{ width: 68, fontFamily: 'var(--sans)', fontSize: 11, padding: '3px 6px', border: '0.5px solid var(--bs)', borderRadius: 5, background: 'var(--bg)', color: 'var(--f1)' }} />
          <span style={{ fontSize: 10, color: 'var(--f4)' }}>원</span>
          <div style={{ width: 1, background: 'var(--bs)', alignSelf: 'stretch', margin: '0 2px' }} />

          {/* 상품명 검색 */}
          <input type="text" value={filterKwInput}
            onChange={e => setFilterKwInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setFilterKeyword(filterKwInput); setProductPage(0); } }}
            placeholder="상품명 검색 (Enter)"
            style={{ width: 130, fontFamily: 'var(--sans)', fontSize: 11, padding: '3px 8px', border: '0.5px solid var(--bs)', borderRadius: 5, background: 'var(--bg)', color: 'var(--f1)' }} />

          {filterActive && (
            <button className="btn sm" onClick={resetFilters}>초기화</button>
          )}
          {(listErrors.products || listErrors.brands) && (
            <span role="alert" style={{ fontSize: 11, color: 'var(--f3)' }}>{listErrors.products ?? listErrors.brands}</span>
          )}
          {!selectedProduct && runMsg?.startsWith('오류:') && (
            <span role="alert" style={{ fontSize: 11, color: 'var(--f3)' }}>{runMsg}</span>
          )}
          <span className="mono dim" style={{ fontSize: 10, marginLeft: 'auto' }}>
            {loadingProds ? '…' : `${productTotal.toLocaleString()}개`}
          </span>
        </div>
      </section>

      {/* ─── 마스터-디테일 ─── */}
      <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 14, alignItems: 'start' }}>

        {/* 자사 상품 목록 */}
        <section className="panel" style={{ padding: 0 }}>
          <div style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--bs)', background: 'var(--snk)' }}>
            <span style={{ fontSize: 11, color: 'var(--f3)', fontWeight: 500 }}>자사 상품</span>
          </div>

          <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
            {loadingProds ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--bs)' }}>
                  <div style={{ height: 10, background: 'var(--rai)', borderRadius: 3, width: '40%', marginBottom: 5 }} />
                  <div style={{ height: 12, background: 'var(--rai)', borderRadius: 3, width: '80%' }} />
                </div>
              ))
            ) : displayedProducts.length === 0 ? (
              <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>
                {auth.ready && !auth.userId ? '로그인 후 자사 상품을 조회할 수 있습니다' : '조건에 맞는 상품 없음'}
              </div>
            ) : displayedProducts.map(p => {
              const isSelected = selectedProduct?.id === p.id;
              return (
                <div key={p.id}
                  onClick={() => selectProduct(p)}
                  style={{
                    padding: '9px 12px', borderBottom: '0.5px solid var(--bs)',
                    cursor: 'pointer',
                    background: isSelected ? 'color-mix(in srgb, var(--hs) 9%, var(--bg))' : undefined,
                    borderLeft: isSelected ? '2px solid var(--hs)' : '2px solid transparent',
                  }}>
                  <div className="row-flex between center" style={{ marginBottom: 2 }}>
                    <span className="mono dim" style={{ fontSize: 10 }}>#{p.musinsa_no}</span>
                    <span style={{ fontSize: 10, color: 'var(--f3)' }}>{p.brand_name}</span>
                  </div>
                  <div style={{
                    fontSize: 12, fontWeight: isSelected ? 600 : 400,
                    lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.name}
                  </div>
                  <div className="row-flex between center" style={{ marginTop: 4 }}>
                    <div className="row-flex center gap-6">
                      <span className="mono dim" style={{ fontSize: 10 }}>
                        리뷰 {(p.review_count ?? 0).toLocaleString()}
                      </span>
                      {p.satisfaction_score != null && (
                        <span className="mono" style={{ fontSize: 10, color: 'var(--hs)' }}>{formatFiveStarRating(p.satisfaction_score)}</span>
                      )}
                      {p.final_price && (
                        <span className="mono" style={{ fontSize: 10, color: 'var(--f3)' }}>
                          {p.final_price.toLocaleString()}원
                        </span>
                      )}
                    </div>
                    {p.category_code && (
                      <span className="mono dim" style={{ fontSize: 9 }}>
                        {CATEGORY_MAP[p.category_code] ?? p.category_code}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 페이지네이션 */}
          <div className="row-flex between center"
            style={{ padding: '6px 12px', borderTop: '0.5px solid var(--bs)', background: 'var(--snk)' }}>
            <button className="btn sm" onClick={() => setProductPage(p => Math.max(0, p - 1))} disabled={productPage === 0}>←</button>
            <span className="mono dim" style={{ fontSize: 10 }}>
              {productPage + 1} / {Math.ceil(productTotal / PROD_SIZE) || 1}
            </span>
            <button className="btn sm" onClick={() => setProductPage(p => p + 1)}
              disabled={(productPage + 1) * PROD_SIZE >= productTotal}>→</button>
          </div>
        </section>

        {/* 우측 패널 */}
        <div className="col-flex gap-10">
          {!selectedProduct ? (
            <section className="panel" style={{ padding: '48px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--f4)' }}>← 좌측에서 상품을 선택하세요</span>
            </section>
          ) : (
            <>
              {/* 선택 상품 헤더 */}
              <section className="panel" style={{ padding: '12px 14px' }}>
                    <div className="row-flex between center">
                      <div>
                        <div className="row-flex center gap-8">
                          <span className="chip" style={{ fontSize: 11 }}>{selectedProduct.brand_name}</span>
                          {selectedProduct.category_code && (
                            <span className="chip" style={{ fontSize: 10, background: 'var(--snk)', color: 'var(--f3)' }}>
                              {CATEGORY_MAP[selectedProduct.category_code] ?? selectedProduct.category_code}
                            </span>
                          )}
                          {selectedProduct.gender && selectedProduct.gender !== 'A' && (
                            <span className="chip" style={{ fontSize: 10, background: 'var(--snk)', color: 'var(--f3)' }}>
                              {selectedProduct.gender === 'M' ? '남성' : '여성'}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--f1)', marginTop: 5 }}>
                          {selectedProduct.name}
                        </div>
                        <div className="row-flex center gap-10" style={{ marginTop: 4 }}>
                          <span className="mono dim" style={{ fontSize: 11 }}>
                            리뷰 {(selectedProduct.review_count ?? 0).toLocaleString()}건
                          </span>
                          {selectedProduct.final_price && (
                            <span className="mono dim" style={{ fontSize: 11 }}>
                              {fmtVal(selectedProduct.final_price, 'price')}
                              {selectedProduct.discount_rate ? ` (−${fmtVal(selectedProduct.discount_rate, 'pct')})` : ''}
                            </span>
                          )}
                          {selectedProduct.satisfaction_score != null && (
                            <span style={{ fontSize: 11, color: 'var(--hs)' }}>{formatFiveStarRating(selectedProduct.satisfaction_score)}</span>
                          )}
                          {selectedProduct.style_no && (
                            <span className="mono dim" style={{ fontSize: 10 }}>{selectedProduct.style_no}</span>
                          )}
                        </div>
                      </div>
                      <div className="col-flex gap-6" style={{ alignItems: 'flex-end' }}>
                        {runMsg && runMsg.startsWith('allExcluded:') && (
                          <div style={{ fontSize: 11, color: 'var(--f3)', textAlign: 'right', background: 'color-mix(in srgb, var(--chart-orange) 8%, var(--bg))', border: '0.5px solid var(--chart-orange)', borderRadius: 5, padding: '5px 10px' }}>
                            후보 {runMsg.split(':')[1]}건 모두 제외됨
                            <button onClick={() => handleAutoMatch(true)} disabled={running || loadingMatches} className="btn sm" style={{ marginLeft: 8, fontSize: 10 }}>
                              초기화 후 재실행
                            </button>
                          </div>
                        )}
                        {runMsg && !runMsg.startsWith('allExcluded:') && runMsg !== 'none' && (
                          <span role={runMsg.startsWith('오류:') ? 'alert' : 'status'} style={{ fontSize: 11, color: 'var(--f3)' }}>{runMsg}</span>
                        )}
                        {runMsg === 'none' && (
                          <span style={{ fontSize: 11, color: 'var(--f4)' }}>경쟁 브랜드 풀에 해당 카테고리 상품 없음</span>
                        )}
                        <div className="row-flex gap-8 center">
                          <a href={`https://www.musinsa.com/products/${selectedProduct.musinsa_no}`}
                            target="_blank" rel="noopener noreferrer"
                            className="btn sm icon" title="무신사에서 보기">
                            <IcArrowUR size={12} />
                          </a>
                          <button onClick={() => handleAutoMatch()} disabled={running || loadingMatches} className="btn sm"
                            style={{ opacity: running ? 0.6 : 1 }}>
                            {running ? '실행 중…' : '자동 매칭 실행'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* 경쟁 상품 직접 추가 */}
                  <section className="panel" style={{ padding: 0 }}>
                    <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)' }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--f2)', marginBottom: 6 }}>경쟁 상품 직접 추가</div>
                      <input type="text" value={compKw} onChange={e => setCompKw(e.target.value)}
                        placeholder="경쟁 상품 검색…"
                        style={{ width: '100%', fontFamily: 'var(--sans)', fontSize: 12, padding: '6px 10px', border: '0.5px solid var(--bs)', borderRadius: 5, background: 'var(--bg)', color: 'var(--f1)', boxSizing: 'border-box' }} />
                    </div>
                    {(compKw || compSearching) && (
                      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {compSearching ? (
                          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>검색 중…</div>
                        ) : compResults.length === 0 ? (
                          <div style={{ padding: '16px 14px', textAlign: 'center', color: 'var(--f4)', fontSize: 12 }}>"{compKw}"에 해당하는 상품이 없습니다</div>
                        ) : compResults.map(p => {
                          const added = alreadyMatchedIds.has(p.id);
                          return (
                            <div key={p.id} className="row-flex between center"
                              style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--bs)', background: added ? 'var(--snk)' : undefined }}>
                              <div className="row-flex center gap-8">
                                {p.thumbnail_url ? (
                                  <img src={p.thumbnail_url} alt="" style={{ width: 36, height: 36, borderRadius: 5, objectFit: 'cover', border: '0.5px solid var(--bs)', flexShrink: 0 }}
                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                ) : (
                                  <div style={{ width: 36, height: 36, borderRadius: 5, background: 'var(--snk)', border: '0.5px solid var(--bs)', flexShrink: 0 }} />
                                )}
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 500, color: added ? 'var(--f3)' : 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                                    {p.name}
                                  </div>
                                  <div className="row-flex center gap-6" style={{ marginTop: 2 }}>
                                    <span className="mono dim" style={{ fontSize: 10 }}>{p.brand_name}</span>
                                    <span className="mono dim" style={{ fontSize: 10 }}>#{p.musinsa_no}</span>
                                    <span className="mono dim" style={{ fontSize: 10 }}>리뷰 {p.review_count.toLocaleString()}</span>
                                  </div>
                                </div>
                              </div>
                              {added ? (
                                <span style={{ fontSize: 11, color: 'var(--f4)', flexShrink: 0 }}>추가됨</span>
                              ) : (
                                <button onClick={() => handleAddCompetitor(p.id)} disabled={running || loadingMatches || addingComp === p.id}
                                  className="btn sm" style={{ opacity: addingComp === p.id ? 0.5 : 1, flexShrink: 0 }}>
                                  <IcPlus size={11} /> 추가
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* 매칭 목록 */}
                  <section className="panel" style={{ padding: 0 }}>
                    <div className="row-flex between center"
                      style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)' }}>
                      <div className="row-flex gap-4">
                        {([
                          ['all',       `전체 ${matches.length}`],
                          ['confirmed', `확정 ${confirmedCount}`],
                          ['a',         `A등급 ${aCount}`],
                          ['b',         `B등급 ${bCount}`],
                        ] as [MatchFilter, string][]).map(([f, label]) => (
                          <button key={f} onClick={() => setMatchFilter(f)}
                            className={`btn sm ${matchFilter === f ? 'active' : ''}`}
                            style={f === 'a' && matchFilter === f ? { background: 'var(--grade-a)', borderColor: 'var(--grade-a)', color: 'var(--white)' }
                              : f === 'b' && matchFilter === f ? { background: 'var(--grade-b)', borderColor: 'var(--grade-b)', color: 'var(--white)' }
                              : undefined}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ padding: '10px 14px 0', fontSize: 11, color: 'var(--f4)', lineHeight: 1.5 }}>{MATCHING_SCORE_HELP}</div>
                    <div style={{ padding: 14 }}>
                      {loadingMatches ? (
                        <div style={{ textAlign: 'center', color: 'var(--f4)', fontSize: 12, padding: '24px 0' }}>불러오는 중…</div>
                      ) : visibleMatches.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--f4)', fontSize: 12 }}>
                          {matchFilter === 'all' ? (
                            <>매칭 후보가 없습니다<br />
                              <span style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
                                "자동 매칭 실행" 또는 위에서 경쟁 상품을 직접 추가하세요
                              </span>
                            </>
                          ) : matchFilter === 'confirmed' ? '확정된 매칭이 없습니다'
                            : matchFilter === 'a' ? 'A등급 후보가 없습니다'
                            : 'B등급 후보가 없습니다'}
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                          {visibleMatches.map(m => (
                            <MatchCard key={m.id} m={m} disabled={running || loadingMatches}
                              onConfirm={() => handleStatus(m.id, 'confirmed')}
                              onExclude={() => handleStatus(m.id, 'excluded')} />
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── 메인 페이지 ────────────────────────────────────────────────────

type Tab = 'brands' | 'products';

export default function MatchingPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileMatchingView />;
  return <MatchingDesktopView />;
}

function MatchingDesktopView() {
  const [tab, setTab] = React.useState<Tab>('brands');

  return (
    <>
      <div className="page-title">
        <h1>자사 매칭</h1>
        <span className="sub">경쟁 브랜드 풀 구성 후 자사 상품과 경쟁 상품을 매칭하세요</span>
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        <button type="button" className={`tab ${tab === 'brands' ? 'active' : ''}`} onClick={() => setTab('brands')}>
          경쟁 브랜드 풀
        </button>
        <button type="button" className={`tab ${tab === 'products' ? 'active' : ''}`} onClick={() => setTab('products')}>
          상품 매칭
        </button>
      </div>

      {tab === 'brands' ? <BrandPool /> : <ProductMatching />}
    </>
  );
}
