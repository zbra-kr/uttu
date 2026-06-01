'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  fetchOwnBrands, fetchOwnProductsWithPrices, fetchProductMatches,
  type OwnProductWithPrice, type ProductMatchRow,
} from '@/lib/queries';
import MobileFilterChips from '@/components/mobile/MobileFilterChips';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

function fmtScore(s: number | null): string {
  if (s == null) return '';
  return `${Math.round(s * 100)}%`;
}

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

  useEffect(() => {
    fetchOwnBrands().then(bs => {
      setBrands(bs);
      if (bs.length > 0) setBrandId(bs[0].id);
    });
  }, []);

  useEffect(() => {
    if (!brandId) return;
    setLoadingProducts(true);
    setSelectedProduct(null);
    setMatches([]);
    fetchOwnProductsWithPrices({ brandIds: [brandId], limit: 100 })
      .then(({ rows: data }) => { setProducts(data); setLoadingProducts(false); })
      .catch(() => setLoadingProducts(false));
  }, [brandId]);

  function handleSelectProduct(p: OwnProductWithPrice) {
    setSelectedProduct(p);
    setLoadingMatches(true);
    fetchProductMatches(p.id)
      .then(data => { setMatches(data); setLoadingMatches(false); })
      .catch(() => setLoadingMatches(false));
  }

  const brandChips = brands.map(b => ({ value: b.id, label: b.name }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      {brandChips.length > 0 && (
        <MobileFilterChips items={brandChips} activeValue={brandId} onChange={setBrandId} />
      )}

      {/* 자사 상품 선택 */}
      {!selectedProduct ? (
        <>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>자사 상품 선택</div>
          {loadingProducts ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
          ) : products.length === 0 ? (
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
                onClick={() => { setSelectedProduct(null); setMatches([]); }}
                style={{ background: 'none', border: 'none', color: 'var(--f3)', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* 유사 경쟁 상품 */}
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
            유사 경쟁 상품 {matches.length}개
          </div>
          {loadingMatches ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
          ) : matches.length === 0 ? (
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
                    유사도 {fmtScore(m.score)}
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
