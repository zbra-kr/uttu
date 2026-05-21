'use client';
import React from 'react';
import { IcDownload, IcEdit, IcPlus, IcCheck, IcX } from '@/components/ui/icons';
import { fetchOwnProducts, type OwnProduct } from '@/lib/queries';

const MATCHES: [string, string, number, number, number[], number, number, string][] = [
  ['커버낫', '시그니처 로고 스웻셔츠', 79000, 92, [98, 88, 95, 84], 1284, 4.5, '→0'],
  ['디스이즈네버댓', '베이직 크루 스웻 SS24', 64000, 88, [98, 92, 78, 80], 892, 4.4, '↑3'],
  ['컨버스', '레터링 스웻', 58000, 78, [96, 84, 62, 70], 432, 4.3, '→0'],
  ['LMC', '베이직 크루 스웻 (네이비)', 72000, 72, [98, 88, 52, 50], 224, 4.2, '↑2'],
  ['몬츠', '스웻셔츠 (라운드)', 55000, 68, [92, 76, 58, 48], 142, 4.1, '↓1'],
];

export default function MatchingPage() {
  const [products, setProducts] = React.useState<OwnProduct[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState(0);

  React.useEffect(() => {
    fetchOwnProducts(100)
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const own = products[selected];

  return (
    <>
      <div className="page-title">
        <h1>자사 매칭</h1>
        <span className="sub">자사 SKU와 외부 경쟁 상품의 유사도 비교 · AI 추천 + 수동 확정</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <button className="btn sm"><IcDownload /> CSV</button>
        </div>
      </div>

      <div className="grid grid-5 gap-8">
        {[
          ['자사 상품', loading ? '…' : products.length.toLocaleString(), '리뷰 있는 상품'],
          ['확정 매칭', '—', '준비 중'],
          ['AI 추천 대기', '—', '준비 중'],
          ['별점', own ? (own.satisfaction_score != null ? `★${own.satisfaction_score}` : '—') : '—', '선택 상품 (5점 만점)'],
          ['선택 상품 리뷰', own ? own.review_count.toLocaleString() : '—', '누적'],
        ].map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '320px 1fr', gap: 14 }}>
        <section className="panel" style={{ padding: 0 }}>
          <div className="row-flex between center" style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>자사 상품</h3>
            <span className="mono dim" style={{ fontSize: 11 }}>{loading ? '…' : `${products.length}건`}</span>
          </div>
          <div className="col-flex" style={{ maxHeight: 560, overflowY: 'auto' }}>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ padding: '12px 14px', borderBottom: '0.5px dashed var(--bs)' }}>
                  <div style={{ height: 12, background: 'var(--rai)', borderRadius: 3, marginBottom: 6, width: '60%' }} />
                  <div style={{ height: 14, background: 'var(--rai)', borderRadius: 3, width: '80%' }} />
                </div>
              ))
            ) : products.map((p, i) => (
              <div key={p.id} onClick={() => setSelected(i)}
                style={{ padding: '12px 14px', background: selected === i ? 'var(--snk)' : 'transparent', borderLeft: selected === i ? '2px solid var(--hs)' : '2px solid transparent', borderBottom: '0.5px dashed var(--bs)', cursor: 'pointer' }}>
                <div className="row-flex between center" style={{ marginBottom: 3 }}>
                  <span className="mono dim" style={{ fontSize: 11 }}>#{p.musinsa_no}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--f2)' }}>{p.brand_name}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: selected === i ? 500 : 400 }}>{p.name}</div>
                <div className="row-flex between center" style={{ marginTop: 6 }}>
                  <span className="mono dim" style={{ fontSize: 10 }}>리뷰 {p.review_count.toLocaleString()}</span>
                  {p.satisfaction_score != null && (
                    <span className="chip" style={{ background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)' }}>★{p.satisfaction_score}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="col-flex gap-12">
          {own ? (
            <section className="panel">
              <div className="row-flex between baseline">
                <div>
                  <div className="row-flex baseline gap-8">
                    <span className="mono dim" style={{ fontSize: 12 }}>#{own.musinsa_no}</span>
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>{own.name}</h2>
                  </div>
                  <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
                    {own.brand_name} · 리뷰 {own.review_count.toLocaleString()}건
                    {own.satisfaction_score != null && ` · 별점 ★${own.satisfaction_score}`}
                  </div>
                </div>
                <div className="row-flex gap-6">
                  <button className="btn sm"><IcEdit /> 정보 편집</button>
                  <button className="btn sm">상품 페이지 ↗</button>
                </div>
              </div>
            </section>
          ) : (
            <section className="panel">
              <div className="col-flex center" style={{ padding: '20px 0', color: 'var(--f4)', alignItems: 'center' }}>
                <span style={{ fontSize: 12 }}>좌측에서 상품을 선택하세요</span>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="sec-head">
              <h3>매칭 후보 <span className="sub">유사도 ≥60% · AI 추천 (샘플)</span></h3>
              <button className="btn sm"><IcPlus /> 수동 추가</button>
            </div>
            <div className="tbl">
              <div className="row head" style={{ gridTemplateColumns: '100px 1fr 80px 60px 1fr 60px 60px 70px 90px' }}>
                <span>브랜드</span><span>상품</span><span className="cell-r">가격</span><span className="cell-r">변동</span><span>유사도 (카·가·이·키)</span><span className="cell-r">★</span><span className="cell-r">리뷰</span><span className="cell-r">종합</span><span></span>
              </div>
              {MATCHES.map((m, i) => {
                const confirmed = i === 0;
                return (
                  <div key={i} className={`row hover ${i % 2 ? 'alt' : ''}`}
                    style={{ gridTemplateColumns: '100px 1fr 80px 60px 1fr 60px 60px 70px 90px', background: confirmed ? 'var(--hs-soft)' : undefined }}>
                    <span><span className="chip">{m[0]}</span></span>
                    <span style={{ fontWeight: confirmed ? 500 : 400, color: confirmed ? 'var(--hs)' : 'var(--f1)' }}>{m[1]}</span>
                    <span className="mono muted cell-r">{m[2].toLocaleString()}</span>
                    <span className={`mono cell-r ${m[7].startsWith('↑') ? 'up' : m[7].startsWith('↓') ? 'dn' : 'dim'}`}>{m[7]}</span>
                    <span className="row-flex center gap-3">
                      {m[4].map((v, j) => (
                        <div key={j} title={['카테고리', '가격대', '이미지', '키워드'][j]}
                          style={{ width: 18, height: 14, background: 'var(--snk)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${v}%`, background: v >= 80 ? 'var(--tu)' : v >= 60 ? 'var(--smf)' : 'var(--bd)' }} />
                        </div>
                      ))}
                      <span className="mono dim" style={{ fontSize: 10, marginLeft: 4 }}>{m[4].join('/')}</span>
                    </span>
                    <span className="mono muted cell-r">{m[6]}</span>
                    <span className="mono muted cell-r">{m[5].toLocaleString()}</span>
                    <span className="mono cell-r" style={{ color: m[3] >= 90 ? 'var(--hs)' : 'var(--f1)', fontWeight: 500 }}>{m[3]}%</span>
                    <span className="row-flex gap-2">
                      {confirmed ? (
                        <span className="chip" style={{ background: 'var(--hs)', color: 'var(--bg)', borderColor: 'var(--hs)' }}>확정</span>
                      ) : (
                        <><button className="btn sm icon" title="확정"><IcCheck /></button><button className="btn sm icon" title="제외"><IcX /></button></>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="row-flex center" style={{ padding: '10px 14px', borderTop: '0.5px solid var(--bs)' }}>
              <span className="mono dim" style={{ fontSize: 11 }}>경쟁 상품 매칭 데이터 — 수집 개발 예정</span>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
