'use client';
import React from 'react';
import { Spark, Line, Donut, HeatCell, HBar } from '@/components/ui/charts';
import { IcBookmark, IcChevR, IcArrowUR } from '@/components/ui/icons';
import Link from 'next/link';

export default function CompanyPage() {
  const [tab, setTab] = React.useState<'disclosure' | 'insight'>('disclosure');
  return (
    <>
      <div className="page-title">
        <h1>코웰패션</h1>
        <span className="chip mono">033290 · KOSDAQ</span>
        <span className="chip">의복·신발 도소매</span>
        <span className="sub">산하 브랜드 5 · 추적 상품 1,284 · 무신사 점유 12.4%</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <button className="btn sm"><IcBookmark /> 북마크</button>
          <button className="btn sm">↗ DART 원문</button>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'disclosure' ? 'active' : ''}`} onClick={() => setTab('disclosure')}>공시·재무</div>
        <div className={`tab ${tab === 'insight' ? 'active' : ''}`} onClick={() => setTab('insight')}>시장 인사이트</div>
        <div className="tab">산하 브랜드</div>
        <div className="tab">이상탐지 <span className="mono dim" style={{ fontSize: 10 }}>(3)</span></div>
        <div className="tab">메모</div>
      </div>

      {tab === 'disclosure' ? <CoDisclosure /> : <CoInsight />}
    </>
  );
}

function CoDisclosure() {
  return (
    <div className="col-flex gap-14">
      <section className="panel surface" style={{ textAlign: 'center', padding: '60px 40px' }}>
        <div className="sec-tag" style={{ marginBottom: 12 }}>dart 데이터 준비 중</div>
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>DART 공시·재무 데이터 수집 예정</div>
        <p style={{ margin: '0 auto', maxWidth: 480, fontSize: 13, lineHeight: '20px', color: 'var(--f2)' }}>
          DART OpenAPI 연동 후 분기보고서·사업보고서·주요계약 공시가 자동 수집됩니다.
          재무팀 협의 완료 후 스크래퍼 배포 예정입니다.
        </p>
        <div className="row-flex center gap-8" style={{ marginTop: 20, justifyContent: 'center' }}>
          {['분기보고서', '사업보고서', '주요계약', '임원변경', '단일판매'].map((t, i) => (
            <span key={i} className="chip" style={{ opacity: 0.5 }}>{t}</span>
          ))}
        </div>
      </section>
    </div>
  );
}

function CoInsight() {
  return (
    <div className="col-flex gap-14">
      <div className="panel" style={{ padding: '10px 16px', fontSize: 12, color: 'var(--f3)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="sec-tag">preview</span>
        <span>아래 수치는 DART 연동 전 임시 목업입니다 — 실데이터 수집 후 자동 갱신됩니다.</span>
      </div>
      <div className="grid grid-6 gap-8">
        {[['무신사 GMV 추정', '—', '', '', ''], ['TOP100 진입', '—', '', '', ''], ['평균 상품 랭킹', '—', '', '', ''], ['활성 SKU', '—', '', '', ''], ['평균 평점', '—', '', '', ''], ['진행 프로모션', '—', '', '', '']].map(([l, v, u, d, dir], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val" style={{ color: 'var(--f4)' }}>{v}<span className="unit">{u ? ` ${u}` : ''}</span></div>
            <div className="dlt">
              {dir === 'up' && <span className="up">{d}</span>}
              {dir === 'dn' && <span className="dn">{d}</span>}
            </div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="sec-head">
          <h3>산하 브랜드 — 무신사 성과 <span className="sub">평균 랭킹·점유·기여도</span></h3>
          <div className="row-flex gap-4">
            <button className="btn sm">7D</button><button className="btn sm active">30D</button><button className="btn sm">90D</button>
          </div>
        </div>
        <div className="tbl">
          <div className="row head" style={{ gridTemplateColumns: '1fr 110px 90px 110px 110px 70px 44px' }}>
            <span>브랜드</span><span className="cell-r">top100</span><span className="cell-r">평균 랭킹</span><span className="cell-r">gmv 기여</span><span>추이</span><span className="cell-r">평점</span><span></span>
          </div>
          {[['커버낫', '8', '142', '21.2억', true, '4.5'], ['디스이즈네버댓', '4', '168', '9.4억', true, '4.4'], ['오라리', '2', '224', '4.1억', false, '4.2'], ['인사일런스', '0', '348', '2.6억', false, '4.0']].map((row, i) => (
            <div key={i} className={`row hover ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: '1fr 110px 90px 110px 110px 70px 44px' }}>
              <span style={{ fontWeight: 500 }}>{row[0]}</span>
              <span className="mono muted cell-r">{row[1]}</span>
              <span className="mono muted cell-r">{row[2]}</span>
              <span className="mono cell-r" style={{ fontWeight: 500 }}>{row[3]}</span>
              <span><Spark w={90} h={20} up={row[4] as boolean} /></span>
              <span className="mono muted cell-r">{row[5]}</span>
              <span><Link href="/brand" className="btn sm icon"><IcArrowUR /></Link></span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: '1.1fr 1fr', gap: 14 }}>
        <section className="panel">
          <div className="sec-head"><h3>카테고리 × 가격대 분포 <span className="sub">회사 전체 218 SKU</span></h3></div>
          <div className="grid" style={{ gridTemplateColumns: '70px repeat(6, 1fr)', gap: 3 }}>
            <div></div>
            {['~3만', '3~5', '5~7', '7~10', '10~15', '15+'].map((p, i) => (
              <div key={i} className="mono dim" style={{ fontSize: 10, textAlign: 'center' }}>{p}</div>
            ))}
            {[['상의', [12, 28, 38, 22, 8, 4]], ['아우터', [2, 6, 12, 22, 28, 18]], ['하의', [8, 18, 24, 18, 9, 3]], ['신발', [0, 3, 9, 16, 22, 14]], ['액세서리', [22, 16, 9, 4, 1, 0]]].map(([cat, vals], ci) => (
              <React.Fragment key={ci}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--f2)', display: 'flex', alignItems: 'center' }}>{cat as string}</div>
                {(vals as number[]).map((v, i) => <HeatCell key={i} value={v} max={40} />)}
              </React.Fragment>
            ))}
          </div>
          <div className="dim mono" style={{ fontSize: 11, marginTop: 10 }}>중심대 — 상의 5~7만 / 아우터 10~15만. 자사 갭은 상의대에서 큼.</div>
        </section>

        <section className="panel">
          <div className="sec-head"><h3>주요 상품 — 회사 전체 TOP <span className="sub">현재 평균 랭킹순</span></h3><button className="btn sm">전체 ↗</button></div>
          <div className="tbl">
            <div className="row head" style={{ gridTemplateColumns: '34px 1fr 90px 60px 80px' }}>
              <span>#</span><span>상품</span><span>브랜드</span><span className="cell-r">랭킹</span><span className="cell-r">가격</span>
            </div>
            {[['시그니처 로고 스웻', '커버낫', '02', '79,000'], ['카고 팬츠', '커버낫', '38', '92,000'], ['옥스포드 셔츠', '디스이즈', '54', '64,000'], ['니트 카디건', '오라리', '78', '128,000'], ['후드집업', '커버낫', '88', '109,000'], ['데일리 윈드브레이커', '커버낫', '92', '128,000']].map((row, i) => (
              <div key={i} className={`row hover ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: '34px 1fr 90px 60px 80px' }}>
                <span className="mono dim">{String(i + 1).padStart(2, '0')}</span>
                <span>{row[0]}</span>
                <span><span className="chip">{row[1]}</span></span>
                <span className="mono muted cell-r">{row[2]}</span>
                <span className="mono muted cell-r">{row[3]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-2 gap-12">
        <section className="panel">
          <div className="sec-head"><h3>주력 상품 — 매출 비중 추정 <span className="sub">누적 90일 (랭킹 × 가격 가중)</span></h3></div>
          <div className="row-flex center gap-14">
            <Donut size={108} percent={56} label="56%" sub="top 5" />
            <div className="flex-1">
              {[['시그니처 스웻 (커버낫)', '22%', true], ['카고 팬츠 (커버낫)', '14%', false], ['옥스포드 셔츠 (디스이즈)', '11%', false], ['윈드브레이커 (커버낫)', '9%', false], ['상위 5종 외 (213)', '44%', false]].map(([n, v, hi], i) => (
                <div key={i} className="row-flex between" style={{ padding: '4px 0' }}>
                  <span style={{ color: hi ? 'var(--hs)' : 'var(--f2)', fontSize: 12, fontWeight: hi ? 500 : 400 }}>· {n}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--f2)' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="dim mono" style={{ fontSize: 11, marginTop: 10 }}>커버낫 단일 브랜드가 회사 매출의 55% 추정. 시그니처 스웻이 핵심.</div>
        </section>

        <section className="panel surface">
          <div className="sec-head">
            <h3>회사 ↔ 무신사 연계 인사이트 <span className="sub">ai 추론</span></h3>
            <span className="capsule"><span className="ico" /> auto-generated</span>
          </div>
          <div className="col-flex gap-8">
            {[['공시 매출 −18%', '무신사 GMV +8% — 채널 의존도 상승'], ['커버낫 위주 매출 집중', '브랜드 다각화 필요 신호'], ['프로모션 빈도 ↑', '경쟁 브랜드 동시 세일 — 가격 압박']].map((m, i) => (
              <div key={i} className="panel compact" style={{ display: 'grid', gridTemplateColumns: '1fr 28px 1.6fr', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--f2)' }}>{m[0]}</span>
                <span className="mono hs" style={{ textAlign: 'center', fontSize: 14 }}>↔</span>
                <span style={{ fontSize: 12, color: 'var(--f1)' }}>{m[1]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
