'use client';
import React from 'react';
import { PeriodFilter, FilterBlock, CheckRow, DismissChip, SegGroup } from '@/components/ui/filters';
import { IcDownload, IcBookmark, IcArrowUR, IcX, IcCheck, IcPlus, IcChevL, IcChevR } from '@/components/ui/icons';
import { Line } from '@/components/ui/charts';

// 이상탐지는 아직 실 로직 미구현 — 설계 mock 데이터로 UI 구현 완성
// [time, sev, area, event, target, status]
type ARow = [string, string, string, string, string, string];

const ANOMALY_DATA: ARow[] = [
  ['2026.05.20 03:14', 'hi', '상품',     '가격 −30% (단일 스냅샷)',        '널디 NY 베이직 후디',   'open'],
  ['2026.05.20 03:12', 'hi', '브랜드',   '랭킹 ↑12 (TOP10 진입)',          '아디다스 트레포일 후디','open'],
  ['2026.05.20 03:09', 'md', '리뷰',     '리뷰 평점 4.6 → 3.9',            '자사 베이직 라운드 티', 'open'],
  ['2026.05.20 02:56', 'md', '회사',     '신규 공시 · 분기보고서',         '코웰패션 (커버낫)',     'open'],
  ['2026.05.20 02:48', 'lo', '프로모션', '신규 프로모션 시작',              '아디다스 전체 −15%',    'open'],
  ['2026.05.20 02:31', 'hi', '상품',     '재고 회전 이상',                  '자사 SS24 라인업',      'open'],
  ['2026.05.20 02:14', 'lo', '리뷰',     '신규 리뷰 32건',                  '자사 베이직 티 (8002)', 'open'],
  ['2026.05.20 01:42', 'md', '브랜드',   '브랜드 평균 랭킹 ↑8',             '디스이즈네버댓',        'open'],
  ['2026.05.19 18:24', 'hi', '회사',     '매출 급감 (1Q YoY −18%)',         '코웰패션',              'in-prog'],
  ['2026.05.19 14:08', 'md', '공시',     '임원 변경 공시',                  '코웰패션',              'open'],
  ['2026.05.19 11:52', 'md', '리뷰',     '저점 리뷰 집중 (4월 생산분)',     '자사 베이직 라운드 티', 'in-prog'],
  ['2026.05.19 09:14', 'lo', '프로모션', '신규 프로모션 시작',              '커버낫 시즌세일',        'closed'],
  ['2026.05.18 22:30', 'lo', '상품',     '신상품 등록',                     '아디다스 트레포일 셔츠','closed'],
  ['2026.05.18 18:14', 'hi', '리뷰',     '저점 리뷰 평점 4.0 → 3.6',       '자사 베이직 라운드 티', 'in-prog'],
  ['2026.05.18 12:48', 'md', '브랜드',   '신규 브랜드 추적',                '에스피오나지',          'open'],
  ['2026.05.17 19:24', 'md', '회사',     '판매 의존도 ↑ (무신사 62%)',      '코웰패션',              'open'],
  ['2026.05.17 14:30', 'lo', '프로모션', '진행 종료',                       '오라리 머스트 해브',    'closed'],
];

const ALL_AREAS = ['상품', '브랜드', '회사', '리뷰', '프로모션', '공시'];

function AnomalyDrawer({ item, onClose, onPrev, onNext }: {
  item: ARow; onClose: () => void; onPrev: () => void; onNext: () => void;
}) {
  const [time, sev, area, event, target, status] = item;
  const statusLabel = status === 'open' ? '미해소' : status === 'in-prog' ? '처리 중' : '해소';
  const statusSev   = status === 'open' ? 'hi' : status === 'in-prog' ? 'md' : 'lo';

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 100 }} onClick={onClose} />
      <aside className="drawer" style={{ zIndex: 110 }}>
        <div className="drawer-head">
          <div className="row-flex center gap-8">
            <span className={`sev ${sev}`}><span className="pip" />{sev.toUpperCase()}</span>
            <span className="sec-tag">{area}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{time}</span>
          </div>
          <button className="btn sm icon" onClick={onClose} title="닫기"><IcX /></button>
        </div>

        <div className="drawer-body">
          {/* 이벤트 헤더 */}
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 500, margin: 0, letterSpacing: '-0.018em' }}>{event}</h2>
            <div className="row-flex baseline gap-8" style={{ marginTop: 6 }}>
              <span className="sec-tag">target</span>
              <span style={{ fontSize: 13, color: 'var(--f2)' }}>{target}</span>
            </div>
          </div>

          {/* 처리 상태 */}
          <section className="panel compact">
            <div className="row-flex between center">
              <span className="sec-tag">처리 상태</span>
              <span className={`sev ${statusSev}`}><span className="pip" />{statusLabel}</span>
            </div>
            <div className="row-flex gap-4" style={{ marginTop: 10 }}>
              <button className="btn sm primary"><IcCheck /> 해소로 표시</button>
              <button className="btn sm">처리 중으로</button>
              <button className="btn sm">메모 추가</button>
            </div>
          </section>

          {/* 핵심 지표 */}
          <section className="panel compact">
            <div className="sec-head"><h3>핵심 지표</h3></div>
            <div className="grid grid-3 gap-8">
              {(sev === 'hi'
                ? [['변동폭', '—', '직전 90일 대비'], ['지속 시간', '단일 스냅샷', '03:01 KST'], ['신뢰도', '—', 'AI 추정']]
                : [['관측 빈도', '—', '최근 7일'], ['임계치', '—', '평균 대비'], ['신뢰도', '—', 'AI 추정']]
              ).map(([l, v, d], i) => (
                <div key={i} className="kpi" style={{ padding: '10px 12px' }}>
                  <span className="label">{l}</span>
                  <div className="val" style={{ fontSize: 18 }}>{v}</div>
                  <div className="dlt"><span className="muted">{d}</span></div>
                </div>
              ))}
            </div>
          </section>

          {/* 추이 */}
          <section className="panel compact">
            <div className="sec-head"><h3>최근 추이 <span className="sub">90일</span></h3></div>
            <Line h={120} yMin={0} yMax={100}
              series={[{ points: [88, 85, 86, 84, 82, 80, 82, 78, 75, 78, 76, 62, 79], color: 'var(--f1)' }]} />
          </section>

          {/* 자사 영향도 */}
          <section className="panel compact surface">
            <div className="sec-head">
              <h3>자사 영향도 <span className="sub">ai 추론</span></h3>
              <span className="capsule"><span className="ico" /> auto</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--f2)' }}>
              이 변화는 자사 동일 카테고리·가격대 상품과 직접 경쟁 관계로 분석됩니다.
              과거 유사 패턴 발생 시 자사 매출 ~7% 감소가 관측되었음.
            </p>
            <div className="row-flex gap-6" style={{ marginTop: 10 }}>
              <button className="btn sm">↗ 외부 상품</button>
              <button className="btn sm">↗ 카테고리 트렌드</button>
            </div>
          </section>

          {/* 타임라인 */}
          <section>
            <div className="sec-head"><h3>이벤트 히스토리</h3></div>
            <div className="timeline">
              {[
                [time.split(' ')[1] || time, sev,  `스냅샷 수집 시 신호 감지`],
                ['직전', 'lo', '직전 90일 정상 범위 내 안정 추이'],
              ].map(([t, sv, body]: any, i) => (
                <div key={i} className={`tl-item ${sv}`}>
                  <span className="time">{t}</span>
                  <span className="dot" />
                  <span className="body">{body}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 메모 */}
          <section>
            <div className="sec-head"><h3>메모</h3></div>
            <button className="btn sm"><IcPlus /> 메모 추가</button>
          </section>
        </div>

        <div className="drawer-foot">
          <button className="btn sm icon" onClick={onPrev}><IcChevL /></button>
          <button className="btn sm icon" onClick={onNext}><IcChevR /></button>
          <div className="flex-1" />
          <button className="btn sm"><IcDownload /> 공유</button>
          <button className="btn primary sm"><IcCheck /> 해소 + 다음</button>
        </div>
      </aside>
    </>
  );
}

export default function AnomalyPage() {
  const [period,   setPeriod]   = React.useState('7d');
  const [fromDate, setFromDate] = React.useState('2026-04-20');
  const [toDate,   setToDate]   = React.useState('2026-05-20');

  const [sev,    setSev]    = React.useState(new Set(['hi', 'md', 'lo']));
  const [area,   setArea]   = React.useState(new Set(ALL_AREAS));
  const [status, setStatus] = React.useState('open');
  const [detail, setDetail] = React.useState<ARow | null>(null);
  const detailIdx = detail ? ANOMALY_DATA.indexOf(detail) : -1;

  const toggleSev  = (k: string) => setSev(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleArea = (k: string) => setArea(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const data = ANOMALY_DATA.filter(r => {
    if (!sev.has(r[1]))  return false;
    if (!area.has(r[2])) return false;
    if (status !== 'all' && r[5] !== status) return false;
    return true;
  });

  const sevCount  = (k: string) => ANOMALY_DATA.filter(r => r[1] === k).length;
  const areaCount = (k: string) => ANOMALY_DATA.filter(r => r[2] === k).length;

  const periodLabel = period === 'today' ? '오늘' : period === '7d' ? '7일' :
    period === '30d' ? '30일' : period === '90d' ? '90일' : `${fromDate} ~ ${toDate}`;

  const reset = () => {
    setPeriod('7d');
    setSev(new Set(['hi', 'md', 'lo']));
    setArea(new Set(ALL_AREAS));
    setStatus('open');
  };

  return (
    <>
      <div className="page-title">
        <h1>이상탐지</h1>
        <span className="chip mono">{periodLabel}</span>
        <span className="sub">자동 발견된 특이점 — 영역·심각도·해소 상태로 필터</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <button className="btn sm"><IcDownload /> CSV</button>
          <button className="btn sm"><IcBookmark /> 필터 저장</button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-5 gap-8">
        {[
          ['전체 (7일)', String(ANOMALY_DATA.length), '+ 4 vs 직전'],
          ['HIGH',  String(sevCount('hi')),  '심각 신호'],
          ['미해소', String(ANOMALY_DATA.filter(r => r[5] === 'open').length),    ''],
          ['처리 중', String(ANOMALY_DATA.filter(r => r[5] === 'in-prog').length), ''],
          ['해소됨', String(ANOMALY_DATA.filter(r => r[5] === 'closed').length),  ''],
        ].map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '280px 1fr', gap: 14 }}>
        {/* 필터 레일 */}
        <aside className="filter-rail">
          <div className="frh">
            <h3>필터</h3>
            <button className="btn sm" onClick={reset}>초기화</button>
          </div>
          <div className="frb">
            <PeriodFilter
              value={period} onChange={setPeriod}
              from={fromDate} to={toDate}
              onFromChange={setFromDate} onToChange={setToDate}
            />

            <FilterBlock label="심각도" hint={`${sev.size}/3`}>
              {[['hi', 'HIGH'], ['md', 'MED'], ['lo', 'LOW']].map(([k, l]) => (
                <CheckRow key={k}
                  on={sev.has(k)}
                  onToggle={() => toggleSev(k)}
                  label={<span className={`sev ${k}`}><span className="pip" />{l}</span>}
                  count={sevCount(k)}
                />
              ))}
            </FilterBlock>

            <FilterBlock label="영역" hint={`${area.size}/${ALL_AREAS.length}`}>
              {ALL_AREAS.map(a => (
                <CheckRow key={a}
                  on={area.has(a)}
                  onToggle={() => toggleArea(a)}
                  label={a}
                  count={areaCount(a)}
                />
              ))}
            </FilterBlock>

            <FilterBlock label="처리 상태">
              <SegGroup value={status} onChange={setStatus}
                options={[
                  ['all',     '전체'],
                  ['open',    '미해소'],
                  ['in-prog', '처리 중'],
                  ['closed',  '해소'],
                ]} />
            </FilterBlock>
          </div>
        </aside>

        {/* 결과 테이블 */}
        <div className="col-flex gap-10">
          <div className="row-flex center gap-6 wrap">
            <span className="sec-tag">applied</span>
            <DismissChip onDismiss={() => setPeriod('7d')}>{periodLabel}</DismissChip>
            {[...sev].map(s => (
              <DismissChip key={s} onDismiss={() => toggleSev(s)}>
                <span className={`sev ${s}`}><span className="pip" />{s.toUpperCase()}</span>
              </DismissChip>
            ))}
            {area.size < ALL_AREAS.length && (
              <DismissChip onDismiss={() => setArea(new Set(ALL_AREAS))}>
                영역 {area.size}/{ALL_AREAS.length}
              </DismissChip>
            )}
            {status !== 'all' && (
              <DismissChip onDismiss={() => setStatus('all')}>
                {status === 'open' ? '미해소' : status === 'in-prog' ? '처리 중' : '해소'}
              </DismissChip>
            )}
            <div className="flex-1" />
            <span className="mono dim" style={{ fontSize: 12 }}>{data.length}건 / {ANOMALY_DATA.length}</span>
          </div>

          <section className="panel" style={{ padding: 0 }}>
            <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
              <div className="row head" style={{ gridTemplateColumns: '130px 60px 70px 1fr 220px 80px 46px' }}>
                <span>시각</span>
                <span>sev</span>
                <span>영역</span>
                <span>이벤트</span>
                <span>대상</span>
                <span>상태</span>
                <span></span>
              </div>
              {data.map((r, i) => {
                const statusLabel = r[5] === 'open' ? '미해소' : r[5] === 'in-prog' ? '처리 중' : '해소';
                const statusSev   = r[5] === 'open' ? 'hi'     : r[5] === 'in-prog' ? 'md'      : 'lo';
                return (
                  <div key={i} className={`row hover ${i % 2 ? 'alt' : ''}`}
                    style={{ gridTemplateColumns: '130px 60px 70px 1fr 220px 80px 46px', cursor: 'pointer' }}
                    onClick={() => setDetail(r)}>
                    <span className="mono dim">{r[0]}</span>
                    <span><span className={`sev ${r[1]}`}><span className="pip" />{r[1].toUpperCase()}</span></span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--f2)' }}>{r[2]}</span>
                    <span>{r[3]}</span>
                    <span className="muted ellip">{r[4]}</span>
                    <span><span className={`sev ${statusSev}`}><span className="pip" />{statusLabel}</span></span>
                    <span><button className="btn sm icon" onClick={e => { e.stopPropagation(); setDetail(r); }}><IcArrowUR /></button></span>
                  </div>
                );
              })}
              {data.length === 0 && (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)' }}>
                  <span className="sec-tag">no results</span>
                  <div style={{ marginTop: 8, fontSize: 12 }}>조건에 맞는 이상탐지가 없습니다.</div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {detail && (
        <AnomalyDrawer
          item={detail}
          onClose={() => setDetail(null)}
          onPrev={() => {
            const i = ANOMALY_DATA.indexOf(detail);
            if (i > 0) setDetail(ANOMALY_DATA[i - 1]);
          }}
          onNext={() => {
            const i = ANOMALY_DATA.indexOf(detail);
            if (i < ANOMALY_DATA.length - 1) setDetail(ANOMALY_DATA[i + 1]);
          }}
        />
      )}
    </>
  );
}
