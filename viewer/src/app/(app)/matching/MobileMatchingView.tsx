'use client';
import { useState, useEffect, useRef } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import Link from 'next/link';
import { formatMatchingScore, MATCHING_SCORE_HELP } from '@/lib/matching-score';
import {
  fetchOwnBrands, fetchOwnProductsWithPrices, fetchProductMatches,
  type OwnProductWithPrice, type ProductMatchRow,
} from '@/lib/queries';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

function fmtPrice(v: number | null): string {
  if (v == null) return '';
  return `${Math.round(v / 1000).toLocaleString()}천원`;
}

export default function MobileMatchingView() {
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandId, setBrandId] = useState('');
  const [products, setProducts] = useState<OwnProductWithPrice[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<OwnProductWithPrice | null>(null);
  const [matches, setMatches] = useState<ProductMatchRow[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);

  const [auth, setAuth] = useState({ ready: false, userId: null as string | null, epoch: 0 });
  const [errors, setErrors] = useState<{ brands: string | null; products: string | null; matches: string | null }>({ brands: null, products: null, matches: null });
  const [attempt, setAttempt] = useState({ brands: 0, products: 0, matches: 0 });
  const [loadingBrands, setLoadingBrands] = useState(true);
  const identity = useRef(auth);
  const scope = useRef({ brandId: '', productId: null as string | null });
  const productRequest = useRef(0);
  const matchRequest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const { data: { subscription } } = supabaseBrowser().auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const userId = session?.user.id ?? null;
      if (identity.current.ready && identity.current.userId === userId) return;
      const changed = identity.current.ready;
      identity.current = { ready: true, userId, epoch: identity.current.epoch + (changed ? 1 : 0) };
      scope.current = { brandId: '', productId: null };
      productRequest.current++; matchRequest.current++;
      setBrands([]); setBrandId(''); setProducts([]); setSelectedProduct(null); setMatches([]);
      setLoadingProducts(false); setLoadingMatches(false); setLoadingBrands(!!userId);
      setErrors({ brands: null, products: null, matches: null });
      setAuth(identity.current);
    });
    return () => { cancelled = true; mounted.current = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!auth.ready || !auth.userId) return;
    let cancelled = false;
    const epoch = auth.epoch;
    const current = () => !cancelled && mounted.current && epoch === identity.current.epoch;
    setLoadingBrands(true); setErrors(prev => ({ ...prev, brands: null }));
    fetchOwnBrands().then(rows => {
      if (!current()) return;
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string')) throw new Error('Invalid brands');
      setBrands(rows);
      const id = rows[0]?.id ?? '';
      scope.current = { brandId: id, productId: null };
      productRequest.current++; matchRequest.current++;
      setBrandId(id); setLoadingProducts(!!id);
    }).catch(() => {
      if (current()) setErrors(prev => ({ ...prev, brands: '오류: 자사 브랜드를 불러오지 못했습니다.' }));
    }).finally(() => { if (current()) setLoadingBrands(false); });
    return () => { cancelled = true; };
  }, [auth.ready, auth.userId, auth.epoch, attempt.brands]);

  useEffect(() => {
    if (!auth.ready || !auth.userId || !brandId) return;
    let cancelled = false;
    const epoch = auth.epoch;
    const version = ++productRequest.current;
    const current = () => !cancelled && mounted.current && epoch === identity.current.epoch
      && brandId === scope.current.brandId && version === productRequest.current;
    setLoadingProducts(true); setProducts([]); setErrors(prev => ({ ...prev, products: null }));
    fetchOwnProductsWithPrices({ brandIds: [brandId], limit: 100 }).then(result => {
      if (!current()) return;
      if (!Array.isArray(result?.rows) || result.rows.some(row => !row || typeof row.id !== 'string')) throw new Error('Invalid products');
      setProducts(result.rows);
    }).catch(() => {
      if (current()) setErrors(prev => ({ ...prev, products: '오류: 자사 상품을 불러오지 못했습니다.' }));
    }).finally(() => { if (current()) setLoadingProducts(false); });
    return () => { cancelled = true; };
  }, [auth.ready, auth.userId, auth.epoch, brandId, attempt.products]);

  useEffect(() => {
    if (!auth.ready || !auth.userId || !selectedProduct) return;
    let cancelled = false;
    const epoch = auth.epoch;
    const productId = selectedProduct.id;
    const version = ++matchRequest.current;
    const current = () => !cancelled && mounted.current && epoch === identity.current.epoch
      && brandId === scope.current.brandId && productId === scope.current.productId && version === matchRequest.current;
    setMatches([]); setLoadingMatches(true); setErrors(prev => ({ ...prev, matches: null }));
    fetchProductMatches(productId).then(rows => {
      if (!current()) return;
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string'
        || (row.own_product_id != null && row.own_product_id !== productId))) throw new Error('Invalid matches');
      setMatches(rows);
    }).catch(() => {
      if (current()) setErrors(prev => ({ ...prev, matches: '오류: 매칭 목록을 불러오지 못했습니다.' }));
    }).finally(() => { if (current()) setLoadingMatches(false); });
    return () => { cancelled = true; };
  }, [auth.ready, auth.userId, auth.epoch, brandId, selectedProduct, attempt.matches]);

  function handleChangeBrand(id: string) {
    if (auth.epoch !== identity.current.epoch || !identity.current.userId || scope.current.brandId === id) return;
    scope.current = { brandId: id, productId: null };
    productRequest.current++; matchRequest.current++;
    setBrandId(id); setProducts([]); setSelectedProduct(null); setMatches([]);
    setLoadingProducts(!!id); setLoadingMatches(false);
    setErrors(prev => ({ ...prev, products: null, matches: null }));
  }
  function handleSelectProduct(p: OwnProductWithPrice) {
    if (auth.epoch !== identity.current.epoch || !identity.current.userId || brandId !== scope.current.brandId || scope.current.productId === p.id) return;
    scope.current.productId = p.id; matchRequest.current++;
    setSelectedProduct(p); setMatches([]); setLoadingMatches(true);
    setErrors(prev => ({ ...prev, matches: null }));
  }
  function closeProduct() {
    if (auth.epoch !== identity.current.epoch || brandId !== scope.current.brandId || selectedProduct?.id !== scope.current.productId) return;
    scope.current.productId = null; matchRequest.current++;
    setSelectedProduct(null); setMatches([]); setLoadingMatches(false);
    setErrors(prev => ({ ...prev, matches: null }));
  }
  function retry(stage: 'brands' | 'products' | 'matches') {
    if (auth.epoch !== identity.current.epoch || !identity.current.userId
      || (stage !== 'brands' && brandId !== scope.current.brandId)
      || (stage === 'matches' && selectedProduct?.id !== scope.current.productId)) return;
    if (stage === 'products') productRequest.current++;
    if (stage === 'matches') matchRequest.current++;
    setAttempt(prev => ({ ...prev, [stage]: prev[stage] + 1 }));
  }
  function readError(message: string, stage: 'brands' | 'products' | 'matches') {
    return <div role="alert" style={{ textAlign: 'center', padding: '30px 0', color: 'var(--f3)', fontSize: 13 }}>
      <div>{message}</div>
      <button className="btn sm" onClick={() => retry(stage)} style={{ marginTop: 10 }}>다시 시도</button>
    </div>;
  }

  const brandChips = brands.map(b => ({ value: b.id, label: b.name }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      {brandChips.length > 0 && (
        <MobileFilterChips items={brandChips} activeValue={brandId} onChange={handleChangeBrand} />
      )}

      {/* 자사 상품 선택 */}
      {!selectedProduct ? (
        <>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>자사 상품 선택</div>
          {!auth.ready || loadingBrands ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
          ) : !auth.userId ? (
            <MobileEmptyState title="로그인 후 자사 상품을 조회할 수 있습니다" />
          ) : errors.brands ? readError(errors.brands, 'brands') : brands.length === 0 ? (
            <MobileEmptyState icon="📦" title="자사 브랜드가 없습니다" />
          ) : loadingProducts ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
          ) : errors.products ? readError(errors.products, 'products') : products.length === 0 ? (
            <MobileEmptyState icon="📦" title="상품이 없습니다" />
          ) : (
            products.map(p => (
              <div
                key={p.id}
                onClick={() => handleSelectProduct(p)}
                style={{
                  padding: '10px 12px', background: 'var(--sur)',
                  border: '1px solid var(--bd)', borderRadius: 10, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                {p.thumbnail_url && (
                  <img src={p.thumbnail_url} alt="" width={36} height={36} style={{ borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </div>
                  {p.final_price != null && (
                    <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{fmtPrice(p.final_price)}</div>
                  )}
                </div>
                <span style={{ color: 'var(--f4)', fontSize: 14 }}>→</span>
              </div>
            ))
          )}
        </>
      ) : (
        <>
          {/* 선택된 상품 */}
          <div style={{ padding: '10px 12px', background: 'var(--hs-soft)', border: '1px solid var(--hs)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {selectedProduct.thumbnail_url && (
                <img src={selectedProduct.thumbnail_url} alt="" width={36} height={36} style={{ borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--hs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedProduct.name}
                </div>
              </div>
              <button
                onClick={closeProduct}
                style={{ background: 'none', border: 'none', color: 'var(--f3)', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* 매칭 경쟁 상품 */}
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
            매칭 경쟁 상품 {loadingMatches ? '…' : errors.matches ? '확인 불가' : `${matches.length}개`}
          </div>
          <div style={{ fontSize: 11, color: 'var(--f4)', lineHeight: 1.5 }}>{MATCHING_SCORE_HELP}</div>
          {loadingMatches ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
          ) : errors.matches ? readError(errors.matches, 'matches') : matches.length === 0 ? (
            <MobileEmptyState icon="🔍" title="매칭된 경쟁 상품이 없습니다" />
          ) : (
            matches.map(m => (
              <Link
                key={m.id}
                href={`/product?no=${m.competitor_musinsa_no}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', background: 'var(--sur)',
                  border: '1px solid var(--bd)', borderRadius: 10,
                  textDecoration: 'none', color: 'inherit',
                }}
              >
                {m.competitor_thumbnail && (
                  <img src={m.competitor_thumbnail} alt="" width={36} height={36} style={{ borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.competitor_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--f3)' }}>{m.competitor_brand}</div>
                  <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
                    {formatMatchingScore(m.score)}
                  </div>
                </div>
                <span style={{ color: 'var(--f4)', fontSize: 14 }}>→</span>
              </Link>
            ))
          )}
        </>
      )}
    </div>
  );
}
