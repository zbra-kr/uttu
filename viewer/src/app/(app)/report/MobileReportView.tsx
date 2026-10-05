'use client';
import { useDailyReport } from '@/hooks/useDailyReport';
import BrandEvidenceStatus from '@/components/report/BrandEvidenceStatus';
import PromotionEvidenceStatus from '@/components/report/PromotionEvidenceStatus';
import RecommendEvidenceStatus from '@/components/report/RecommendEvidenceStatus';
import { useState } from 'react';
import { AGE_LABEL, GENDER_LABEL } from '@/lib/queries-report';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

function Section({ title, children, defaultOpen = false }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 13px', background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--f1)', fontSize: 13, fontWeight: 600, textAlign: 'left',
        }}
      >
        <span>{title}</span>
        <span style={{ color: 'var(--f4)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 13px 13px', borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function ReportFrame({ evidence, children }: { evidence: React.ReactNode; children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 20px', width: '100%', minWidth: 0 }}>{evidence}{children}</div>;
}

export default function MobileReportView() {
  const { core, brand, headers, items, promotion, data, retryBrand, retryHeaders, retryItems, recommendModulesSource, recommendItemsSource, recommend, retryRecommendModules, retryRecommendItems } = useDailyReport();
  const promotionStatus = <PromotionEvidenceStatus key="promotion-evidence" headers={headers} items={items} evidence={promotion} retryHeaders={retryHeaders} retryItems={retryItems} rankingDate={data?.kpi.latestDate} />;
  const recommendStatus = <RecommendEvidenceStatus key="recommend-evidence" modules={recommendModulesSource} items={recommendItemsSource} evidence={recommend} retryModules={retryRecommendModules} retryItems={retryRecommendItems} rankingDate={data?.kpi.latestDate} showRows={!data || recommendModulesSource.state !== 'ready' || recommend.modules.length === 0} />;
  const loading = core.state === 'loading';
  const evidence = <><BrandEvidenceStatus source={brand} retry={retryBrand} rankingDate={data?.kpi.latestDate} showRows={!data} />{promotionStatus}{recommendStatus}</>;

  if (loading) return <ReportFrame evidence={evidence}><div role="status" style={{ textAlign: 'center', padding: '20px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div></ReportFrame>;
  if (!data) return <ReportFrame evidence={evidence}><MobileEmptyState icon="📋" title={core.state === 'error' ? '리포트 조회 실패' : core.state === 'signedout' ? '로그인이 필요합니다' : '리포트 데이터가 없습니다'} /></ReportFrame>;

  const {
    kpi, ownBrands, competitors, brandRanking, demoGrid,
    rankingRows, topContent, saleDist, recommendModules, recommendTopBrands,
    channelConversions, priceBuckets, topBrandsByCount,
  } = data;

  return (
    <ReportFrame evidence={evidence}>
      {/* KPI 요약 */}
      <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>{kpi.latestDate} 기준</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { label: '일간 수집', value: kpi.dailyCount.toLocaleString() },
            { label: '주간 수집', value: (kpi.weeklyCount ?? 0).toLocaleString() },
            { label: '상승 상품', value: kpi.risingCount.toLocaleString() },
            { label: '콘텐츠', value: kpi.contentCount.toLocaleString() },
          ].map(k => (
            <div key={k.label} style={{ textAlign: 'center', padding: '8px 0', background: 'var(--snk)', borderRadius: 5 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{k.value}</div>
              <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 1 }}>{k.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* B. 자사 브랜드 현황 */}
      <Section title="B. 우리 브랜드 현황" defaultOpen>
        {ownBrands.length === 0 ? (
          <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--f4)' }}>데이터 없음</p>
        ) : ownBrands.map((b, i) => (
          <div key={b.brandName} style={{ paddingTop: i > 0 ? 8 : 0, marginTop: i > 0 ? 8 : 0, borderTop: i > 0 ? '1px solid var(--bd)' : 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>{b.brandName}</div>
            <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 3 }}>
              일간 최고 {b.dailyBestRank != null ? `#${b.dailyBestRank}` : '—'}
              {b.dailyRankChange != null && ` (${b.dailyRankChange > 0 ? '▲' : '▼'}${Math.abs(b.dailyRankChange)})`}
              {b.brandRank != null && ` · 브랜드랭킹 #${b.brandRank}`}
              {b.hasSale === null ? ' · 세일 확인 못함' : b.hasSale ? ' · 세일 조회 내 노출' : ' · 세일 조회 내 미노출'}
              {b.hasRecommend === null ? ' · 추천 확인 못함' : b.hasRecommend ? ' · 추천 조회 내 노출' : ' · 추천 조회 내 미노출'}
            </div>
          </div>
        ))}
      </Section>

      {/* C. 경쟁사 벤치마크 */}
      <Section title="C. 경쟁사 벤치마크">
        {competitors.length === 0 ? (
          <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--f4)' }}>데이터 없음</p>
        ) : competitors.slice(0, 10).map((c, i) => (
          <div key={c.brandName} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: i > 0 ? 8 : 0, marginTop: i > 0 ? 8 : 0, borderTop: i > 0 ? '1px solid var(--bd)' : 'none' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 18, flexShrink: 0 }}>{i + 1}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: c.isOwn ? 'var(--hs)' : 'var(--f1)' }}>{c.brandName}</div>
              <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
                {c.bestRank != null ? `#${c.bestRank}` : '—'} · SKU {c.productCount}
                {c.hasSale === null ? ' · 세일 확인 못함' : c.hasSale ? ' · 세일 조회 내 노출' : ' · 세일 조회 내 미노출'}
                {c.hasRecommend === null ? ' · 추천 확인 못함' : c.hasRecommend ? ' · 추천 조회 내 노출' : ' · 추천 조회 내 미노출'}
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* S. 전략 인사이트 */}
      <Section title="S. 전략 인사이트">
        {/* 채널 전환율 */}
        {channelConversions.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', marginBottom: 6 }}>판별 랭킹 전환 효과</div>
            {channelConversions.map(ch => (
              <div key={ch.channel} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                  {ch.channel.replace(' (선착순)', '')}
                </span>
                <span style={{ color: 'var(--f4)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                  {ch.exposureBrands}→{ch.matchedBrands} ({ch.rate}%)
                </span>
              </div>
            ))}
          </div>
        )}
        {/* 가격 분포 */}
        {priceBuckets.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', marginBottom: 6 }}>가격 전략 (랭킹 상품)</div>
            {priceBuckets.map(b => (
              <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: 'var(--f2)' }}>{b.label}</span>
                <span style={{ color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{b.count.toLocaleString()}개</span>
              </div>
            ))}
          </div>
        )}
        {/* 랭킹 독점 브랜드 */}
        {topBrandsByCount.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', marginBottom: 6 }}>랭킹 독점 브랜드 TOP 10</div>
            {topBrandsByCount.slice(0, 10).map((b, i) => (
              <div key={b.brand} style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 16, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 11, fontWeight: i < 3 ? 600 : 400, color: 'var(--f1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.brand}</span>
                <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', flexShrink: 0 }}>{b.count}개 · #{b.bestRank}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 1. 콘텐츠판 */}
      <Section title={`1. 콘텐츠판 (${kpi.contentCount}건)`}>
        {topContent.length === 0 ? (
          <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--f4)' }}>데이터 없음</p>
        ) : topContent.map((c, i) => (
          <div key={i} style={{ paddingTop: i > 0 ? 8 : 0, marginTop: i > 0 ? 8 : 0, borderTop: i > 0 ? '1px solid var(--bd)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 18, flexShrink: 0, paddingTop: 2 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {c.landingUrl ? (
                  <a href={c.landingUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, fontWeight: 500, color: 'var(--f1)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title}
                  </a>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--f1)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                )}
                <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2, display: 'flex', gap: 8 }}>
                  <span>{c.brandNames.slice(0, 2).join(', ')}</span>
                  <span>조회 {c.viewCount >= 1000 ? `${(c.viewCount / 1000).toFixed(0)}K` : c.viewCount}</span>
                  {c.rankMatch != null && <span>#{c.rankMatch}</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* 2. 추천판 */}
      <Section title={`2. 추천판 (${recommendModulesSource.state === 'ready' ? recommendModules.length : '—'}개 모듈)`}>
        {recommendModules.length === 0 ? (
          <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--f4)' }}>{recommendModulesSource.state === 'error' ? '추천 모듈을 확인하지 못했습니다' : recommendModulesSource.state === 'loading' ? '추천 모듈 불러오는 중…' : '저장된 추천 모듈이 없습니다'}</p>
        ) : (
          <>
            {recommendModules.slice(0, 8).map((m, i) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: i > 0 ? 6 : 0, marginTop: i > 0 ? 6 : 0, borderTop: i > 0 ? '1px solid var(--bd)' : 'none' }}>
                <span style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 18, flexShrink: 0 }}>{m.position + 1}</span>
                <span style={{ fontSize: 12, color: 'var(--f1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                <span style={{ fontSize: 9, color: 'var(--f4)', fontFamily: 'var(--mono)', flexShrink: 0 }}>{m.itemsCount ?? '—'}개</span>
              </div>
            ))}
            {recommendTopBrands.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--bd)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', marginBottom: 6 }}>아이템 관찰 브랜드 TOP 5</div>
                {recommendTopBrands.slice(0, 5).map((b, i) => (
                  <div key={b.brandName} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: 'var(--f2)' }}>{i + 1}. {b.brandName}</span>
                    <span style={{ color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{b.count}개</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      {/* 3. 세일판 */}
      <Section title={`3. 세일판 (${kpi.saleItemCount?.toLocaleString() ?? '—'}개 상품)`}>
        {saleDist.length === 0 ? (
          <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--f4)' }}>데이터 없음</p>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', marginBottom: 6 }}>할인율 분포</div>
            {saleDist.map((b, i) => (
              <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: i >= 2 ? 'var(--td)' : 'var(--f2)' }}>{b.label}</span>
                <span style={{ color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{b.count.toLocaleString()}개</span>
              </div>
            ))}
            {channelConversions.filter(ch => ch.channel !== '추천판').length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--bd)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', marginBottom: 6 }}>채널 요약</div>
                {channelConversions.filter(ch => ch.channel !== '추천판').map(ch => (
                  <div key={ch.channel} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: 'var(--f2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                      {ch.channel}
                    </span>
                    <span style={{ color: 'var(--f4)', fontFamily: 'var(--mono)', flexShrink: 0 }}>전환 {ch.rate}%</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      {/* 4. 랭킹 분석 */}
      <Section title={`4. 랭킹 분석 (${rankingRows.length.toLocaleString()}개 상품)`}>
        {rankingRows.length === 0 ? (
          <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--f4)' }}>데이터 없음</p>
        ) : rankingRows.slice(0, 10).map((r, i) => (
          <div key={r.musinsaNo} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: i > 0 ? 6 : 0, marginTop: i > 0 ? 6 : 0, borderTop: i > 0 ? '1px solid var(--bd)' : 'none' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 22, flexShrink: 0 }}>#{r.rank}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: r.isOwn ? 600 : 400, color: r.isOwn ? 'var(--hs)' : 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.productName}
              </div>
              <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 1 }}>
                {r.brandName}
                {r.discountRate != null && r.discountRate > 0 && ` · ${r.discountRate}%↓`}
              </div>
            </div>
            {r.rankChange != null && (
              <span style={{ fontSize: 10, color: r.rankChange > 0 ? 'var(--tu)' : 'var(--td)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                {r.rankChange > 0 ? '▲' : '▼'}{Math.abs(r.rankChange)}
              </span>
            )}
          </div>
        ))}
      </Section>

      {/* 5. 브랜드 랭킹 TOP */}
      {brandRanking.length > 0 && (
        <Section title="5. 브랜드 랭킹 TOP">
          {brandRanking.slice(0, 10).map((b, i) => (
            <div key={b.brandName} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: i > 0 ? 6 : 0, marginTop: i > 0 ? 6 : 0, borderTop: i > 0 ? '1px solid var(--bd)' : 'none' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--f4)', fontFamily: 'var(--mono)', width: 20 }}>#{b.rank}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: b.isOwn ? 'var(--hs)' : 'var(--f1)', flex: 1 }}>{b.brandName}</span>
              {b.rankChange != null && (
                <span style={{ fontSize: 10, color: b.rankChange > 0 ? 'var(--tu)' : 'var(--td)', fontFamily: 'var(--mono)' }}>
                  {b.rankChange > 0 ? '▲' : '▼'}{Math.abs(b.rankChange)}
                </span>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* 6. 성별×연령 TOP 3 */}
      {demoGrid.length > 0 && (
        <Section title="6. 성별×연령 TOP 3">
          {demoGrid.slice(0, 6).map((d, i) => (
            <div key={i} style={{ fontSize: 12, paddingTop: i > 0 ? 6 : 0, marginTop: i > 0 ? 6 : 0, borderTop: i > 0 ? '1px solid var(--bd)' : 'none' }}>
              <span style={{ color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
                {GENDER_LABEL[d.gender] ?? d.gender} · {AGE_LABEL[d.age] ?? d.age}
              </span>
              <div style={{ marginTop: 3, fontSize: 11, color: 'var(--f2)' }}>
                {d.top3.map((t, j) => (
                  <div key={j}>#{j + 1} {t.brand} — {t.product}</div>
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}
    </ReportFrame>
  );
}
