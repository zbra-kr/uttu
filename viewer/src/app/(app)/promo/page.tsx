'use client';
import React from 'react';
import { Bars, HBar, Donut, Line } from '@/components/ui/charts';
import { IcFilter, IcDownload, IcChevL, IcChevR, IcPlus } from '@/components/ui/icons';

const PROMO_ITEMS: [string, string, string, string, string, string, number, string][] = [
  ['promo', 'SS24 BIG SALE', '아디다스', '2026.05.19', '2026.06.10', '−15%', 284, 'active'],
  ['sale', '체크 머플러 단독세일', '커버낫', '2026.05.17', '2026.05.31', '−30%', 1, 'active'],
  ['promo', '주말 한정 특가', '널디', '2026.05.18', '2026.05.26', '−30%', 38, 'active'],
  ['promo', '브랜드 위크 — 신상 10% 쿠폰', '디스이즈네버댓', '2026.05.17', '2026.05.28', '−10%', 92, 'active'],
  ['sale', '데일리 윈드브레이커 단독', '커버낫', '2026.05.16', '2026.05.31', '−20%', 1, 'active'],
  ['promo', '봄 정장 페어', '슈트서플라이', '2026.05.17', '2026.06.05', '−25%', 64, 'active'],
  ['promo', '신발 1+1', '나이키', '2026.05.16', '2026.05.30', '특가', 124, 'active'],
  ['promo', '데님 위크', '리바이스', '2026.05.16', '2026.05.31', '−25%', 88, 'active'],
  ['promo', '머스트 해브 셀렉트', '오라리', '2026.05.15', '2026.05.24', '특가', 24, 'active'],
  ['sale', '카고 팬츠 시즌오프', '커버낫', '2026.05.15', '2026.05.27', '−10%', 6, 'active'],
  ['promo', '오피스 위크', '몬츠', '2026.05.15', '2026.05.28', '−20%', 42, 'active'],
  ['sale', '비니 모음 (5종)', '커버낫', '2026.05.14', '2026.05.30', '−25%', 5, 'active'],
  ['promo', '신규회원 −10%', '커버낫', '2025.11.01', '상시', '−10%', 218, 'active'],
  ['sale', '오버사이즈 티 SS', '인사일런스', '2026.05.10', '2026.05.31', '−15%', 12, 'active'],
];

const PRODUCT_POOL: [string, string, string, string, number, string][] = [
  ['아디다스', '트레포일 후디 (블랙)', '79,000', '−15%', 12, '4.4'],
  ['아디다스', '트레포일 후디 (네이비)', '79,000', '−15%', 18, '4.3'],
  ['아디다스', '슈퍼스타 클래식', '129,000', '−15%', 8, '4.6'],
  ['커버낫', '체크 머플러', '38,000', '−30%', 41, '4.6'],
  ['널디', 'NY 베이직 후디', '62,000', '−30%', 7, '4.4'],
  ['널디', 'NY 레터링 스웻', '68,000', '−30%', 18, '4.3'],
  ['디스이즈네버댓', '로고 티 SS24', '32,000', '−10%', 54, '4.5'],
  ['디스이즈네버댓', '옥스포드 셔츠', '64,000', '−10%', 38, '4.4'],
  ['커버낫', '데일리 윈드브레이커', '128,000', '−20%', 22, '4.2'],
  ['슈트서플라이', '슬랙스 SS', '92,000', '−25%', 88, '4.3'],
  ['리바이스', '511 슬림 데님', '128,000', '−25%', 64, '4.4'],
  ['오라리', '와이드 니트 카디건', '178,000', '특가', 78, '4.2'],
  ['커버낫', '카고 팬츠 (스톤)', '92,000', '−10%', 38, '4.4'],
  ['커버낫', '시그니처 로고 스웻', '79,000', '−10%', 2, '4.5'],
];

export default function PromoPage() {
  const [tab, setTab] = React.useState<'hub' | 'calendar' | 'stats'>('hub');
  return (
    <>
      <div className="page-title">
        <h1>프로모션 / 세일</h1>
        <span className="sub">진행중 142 + 89 · 마스터 선택 → 디테일 연동</span>
      </div>
      <div className="tabs">
        <div className={`tab ${tab === 'hub' ? 'active' : ''}`} onClick={() => setTab('hub')}>허브 (마스터-디테일)</div>
        <div className={`tab ${tab === 'calendar' ? 'active' : ''}`} onClick={() => setTab('calendar')}>캘린더</div>
        <div className={`tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>통계</div>
      </div>
      {tab === 'hub' && <PromoHub />}
      {tab === 'calendar' && <PromoCalendar />}
      {tab === 'stats' && <PromoStats />}
    </>
  );
}

function PromoHub() {
  const [typeFilter, setTypeFilter] = React.useState('all');
  const [sel, setSel] = React.useState(new Set([0, 2]));

  const items = PROMO_ITEMS.filter(it => typeFilter === 'all' || it[0] === typeFilter);
  const toggle = (origIdx: number) => {
    setSel(prev => { const next = new Set(prev); next.has(origIdx) ? next.delete(origIdx) : next.add(origIdx); return next; });
  };
  const selectedItems = [...sel].map(i => PROMO_ITEMS[i]).filter(Boolean);
  const totalProducts = selectedItems.reduce((acc, it) => acc + it[6], 0);
  const dedupedProducts = Math.round(totalProducts * 0.78);
  const visible = sel.size === 0 ? [] : PRODUCT_POOL.slice(0, Math.min(PRODUCT_POOL.length, 6 + sel.size * 2));

  return (
    <>
      <section className="panel" style={{ padding: 0 }}>
        <div className="row-flex between center" style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--bs)' }}>
          <div className="row-flex center gap-10">
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>마스터 그리드</h3>
            <span className="sec-tag">{items.length}건 · 클릭해서 선택</span>
          </div>
          <div className="row-flex gap-4 center">
            <span className="mono dim" style={{ fontSize: 11 }}>type</span>
            {['all', 'promo', 'sale'].map(t => (
              <button key={t} className={`btn sm ${typeFilter === t ? 'active' : ''}`} onClick={() => setTypeFilter(t)}>{t === 'all' ? '전체' : t === 'promo' ? '프로모션' : '세일'}</button>
            ))}
            <span style={{ width: 12 }} />
            <span className="mono dim" style={{ fontSize: 11 }}>· {sel.size} 선택</span>
            <button className="btn sm" onClick={() => setSel(new Set(items.map(it => PROMO_ITEMS.indexOf(it))))}>전체 선택</button>
            <button className="btn sm" onClick={() => setSel(new Set())}>해제</button>
          </div>
        </div>
        <div className="tbl" style={{ border: 'none', borderRadius: 0, maxHeight: 320, overflowY: 'auto' }}>
          <div className="row head" style={{ gridTemplateColumns: '32px 60px 1fr 130px 100px 90px 70px 70px 80px' }}>
            <span></span><span>타입</span><span>제목</span><span>브랜드</span><span>시작</span><span>종료</span><span className="cell-r">할인</span><span className="cell-r">상품</span><span>상태</span>
          </div>
          {items.map((row, i) => {
            const origIdx = PROMO_ITEMS.indexOf(row);
            const on = sel.has(origIdx);
            return (
              <div key={origIdx} className={`row hover ${on ? 'flag' : i % 2 ? 'alt' : ''}`}
                style={{ gridTemplateColumns: '32px 60px 1fr 130px 100px 90px 70px 70px 80px', cursor: 'pointer', background: on ? 'var(--snk)' : undefined }}
                onClick={() => toggle(origIdx)}>
                <span><div className={`checkbox ${on ? 'on' : ''}`} style={{ pointerEvents: 'none' }}>{on && '✓'}</div></span>
                <span><span className={`sev ${row[0] === 'promo' ? 'lo' : 'md'}`}><span className="pip" />{row[0] === 'promo' ? '프모' : '세일'}</span></span>
                <span style={{ fontWeight: on ? 500 : 400 }}>{row[1]}</span>
                <span><span className="chip">{row[2]}</span></span>
                <span className="mono dim">{row[3]}</span>
                <span className="mono dim">{row[4]}</span>
                <span className={`mono cell-r ${row[5].includes('30') ? 'hs' : 'muted'}`} style={{ fontWeight: row[5].includes('30') ? 500 : 400 }}>{row[5]}</span>
                <span className="mono muted cell-r">{row[6]}</span>
                <span><span className="sev lo"><span className="pip" />{row[7]}</span></span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="panel compact snk row-flex center gap-8" style={{ flexWrap: 'wrap' }}>
        <span className="sec-tag">selected</span>
        {selectedItems.length === 0 ? (
          <span className="dim" style={{ fontSize: 12 }}>마스터 그리드에서 하나 이상 선택하면 아래 디테일이 나타납니다</span>
        ) : (
          <>
            {selectedItems.slice(0, 6).map((it, i) => {
              const origIdx = PROMO_ITEMS.indexOf(it);
              return (
                <span key={i} className="chip lg" style={{ background: 'var(--rai)', color: 'var(--f1)', borderColor: 'var(--bd)' }}>
                  {it[1]}
                  <span style={{ marginLeft: 4, cursor: 'pointer', color: 'var(--f3)' }} onClick={() => toggle(origIdx)}>×</span>
                </span>
              );
            })}
            {selectedItems.length > 6 && <span className="chip lg">+ {selectedItems.length - 6}</span>}
            <span className="mono dim" style={{ fontSize: 11, marginLeft: 4 }}>· 결합 상품 {dedupedProducts}건 (중복 제외)</span>
          </>
        )}
        <div className="row-flex gap-4" style={{ marginLeft: 'auto' }}>
          <button className="btn sm"><IcFilter /> 필터</button>
          <button className="btn sm"><IcDownload /> CSV</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
        <section className="panel col-flex">
          <div className="sec-head">
            <h3>상품 리스트 <span className="sub">{sel.size === 0 ? '선택 없음' : `합집합 ${dedupedProducts}건 · 할인폭 큰 순`}</span></h3>
            <button className="btn sm">정렬 ▾</button>
          </div>
          {sel.size === 0 ? (
            <div className="col-flex center" style={{ padding: '40px 0', color: 'var(--f4)', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>no selection</span>
              <span style={{ fontSize: 12 }}>마스터에서 프로모션을 선택해 보세요</span>
            </div>
          ) : (
            <div className="tbl flex-1">
              <div className="row head" style={{ gridTemplateColumns: '100px 1fr 80px 60px 60px 50px' }}>
                <span>브랜드</span><span>상품</span><span className="cell-r">가격</span><span className="cell-r">할인</span><span className="cell-r">랭킹</span><span className="cell-r">★</span>
              </div>
              {visible.map((p, i) => (
                <div key={i} className={`row hover ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: '100px 1fr 80px 60px 60px 50px', cursor: 'pointer' }}>
                  <span><span className="chip">{p[0]}</span></span>
                  <span>{p[1]}</span>
                  <span className="mono muted cell-r">{p[2]}</span>
                  <span className={`mono cell-r ${p[3].includes('30') ? 'hs' : 'muted'}`}>{p[3]}</span>
                  <span className="mono muted cell-r">{p[4]}</span>
                  <span className="mono muted cell-r">{p[5]}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="col-flex gap-12">
          <section className="panel">
            <div className="sec-head"><h3>할인폭 분포 <span className="sub">{sel.size === 0 ? '—' : `선택 ${dedupedProducts}건`}</span></h3></div>
            <Bars h={110}
              values={sel.size === 0 ? [0, 0, 0, 0, 0, 0, 0, 0, 0] : [12, 22, 38, 56, 78, 64, 42, 28, 14].map(v => v * (0.4 + sel.size * 0.15))}
              accentIdx={sel.size > 0 ? 4 : undefined} />
            <div className="row-flex between" style={{ marginTop: 6 }}>
              <span className="mono dim" style={{ fontSize: 10 }}>−5%</span>
              <span className="mono dim" style={{ fontSize: 10 }}>−25%</span>
              <span className="mono dim" style={{ fontSize: 10 }}>−50%+</span>
            </div>
          </section>

          <section className="panel">
            <div className="sec-head"><h3>브랜드 TOP 7 <span className="sub">{sel.size === 0 ? '—' : `${selectedItems.length}건 기준`}</span></h3></div>
            {(sel.size === 0
              ? [['—', 0], ['—', 0], ['—', 0], ['—', 0], ['—', 0]]
              : [['커버낫', 64], ['아디다스', 42], ['널디', 38], ['디스이즈', 28], ['인사일런스', 18], ['오라리', 12], ['슈트서플라이', 8]]
            ).map(([n, c], i) => (
              <div key={i} className="row-flex center gap-8" style={{ padding: '4px 0' }}>
                <span style={{ flex: 1, fontSize: 12, color: (c as number) === 0 ? 'var(--f4)' : 'var(--f2)' }}>{n}</span>
                <HBar value={c as number} max={64} accent={i === 0 && (c as number) > 0} w={90} />
                <span className="mono dim" style={{ fontSize: 11, width: 22, textAlign: 'right' }}>{c || '—'}</span>
              </div>
            ))}
          </section>

          <section className="panel surface flex-1" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="sec-head">
              <h3>AI 노트</h3>
              {sel.size > 0 && <span className="capsule"><span className="ico" /> live</span>}
            </div>
            {sel.size === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>선택된 프로모션이 없습니다.</p>
            ) : (
              <p style={{ margin: 0, fontSize: 12, lineHeight: '19px', color: 'var(--f2)' }}>
                선택된 {selectedItems.length}건의 프로모션은 <span className="hs" style={{ fontWeight: 500 }}>
                  {[...new Set(selectedItems.map(it => it[2]))].slice(0, 3).join(', ')}
                </span> 등에서 진행 중.{' '}
                {sel.size >= 3 ? '후디·스웻 카테고리에 집중 — 자사 SS24 가격 검토 권장.' : sel.size === 2 ? '캐주얼 + 베이직 카테고리에 분포.' : '단일 항목 선택. 디테일은 좌측 리스트 참고.'}
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function PromoCalendar() {
  const events: Record<number, { b: string; sev: string }[]> = {
    3: [{ b: '아디다스 −15%', sev: 'h' }],
    6: [{ b: '커버낫 세일 시작', sev: 'm' }, { b: '나이키 신발 1+1', sev: 'l' }],
    7: [{ b: '디스이즈 브랜드 위크', sev: 'm' }],
    15: [{ b: '몬츠 오피스 위크', sev: 'l' }],
    17: [{ b: '리바이스 데님 위크', sev: 'm' }],
    19: [{ b: '널디 주말 한정', sev: 'h' }, { b: 'SS24 BIG SALE D-1', sev: 'h' }],
    20: [{ b: '아디다스 SS24', sev: 'h' }, { b: '커버낫 시즌세일', sev: 'm' }],
    24: [{ b: '오라리 종료', sev: 'l' }],
  };
  return (
    <>
      <div className="row-flex between center">
        <div className="row-flex baseline gap-10">
          <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>2026년 5월</h2>
          <span className="mono dim" style={{ fontSize: 11 }}>· 진행중 142건</span>
        </div>
        <div className="row-flex gap-4">
          <button className="btn sm active">프로모션</button>
          <button className="btn sm active">세일</button>
          <span style={{ width: 8 }} />
          <button className="btn sm icon"><IcChevL /></button>
          <button className="btn sm">오늘</button>
          <button className="btn sm icon"><IcChevR /></button>
        </div>
      </div>
      <section className="panel">
        <div className="cal-head">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <div key={i} className="h">{d}</div>)}
        </div>
        <div className="cal">
          {Array.from({ length: 35 }).map((_, i) => {
            const day = i - 3;
            const inMonth = day >= 1 && day <= 31;
            const today = day === 20;
            const evts = events[day] || [];
            return (
              <div key={i} className={`cal-day ${!inMonth ? 'out' : ''} ${today ? 'today' : ''}`}>
                <div className="num">{inMonth ? day : ''}</div>
                {evts.slice(0, 3).map((e, j) => <div key={j} className={`cal-evt ${e.sev}`}>{e.b}</div>)}
                {evts.length > 3 && <div className="mono dim" style={{ fontSize: 10 }}>+ {evts.length - 3}</div>}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function PromoStats() {
  return (
    <>
      <div className="row-flex between center">
        <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>프로모션 / 세일 — 통계</h2>
        <div className="row-flex gap-4">
          <button className="btn sm">30D</button><button className="btn sm active">90D</button><button className="btn sm">1Y</button>
          <button className="btn sm"><IcFilter /> 필터</button>
        </div>
      </div>

      <div className="grid grid-2 gap-12">
        <section className="panel">
          <div className="sec-head"><h3>기간별 프로모션 건수 <span className="sub">일 단위</span></h3></div>
          <Bars h={120} values={[8, 12, 10, 14, 18, 22, 16, 20, 24, 18, 22, 28]} />
        </section>
        <section className="panel">
          <div className="sec-head"><h3>평균 할인폭 추이 <span className="sub">주 단위</span></h3></div>
          <Line h={120} yMin={0} yMax={30} series={[{ points: [12, 14, 13, 16, 18, 17, 20, 22, 21, 23, 22, 24], color: 'var(--f1)' }]} />
        </section>
      </div>

      <div className="grid grid-3 gap-12">
        <section className="panel">
          <div className="sec-head"><h3>카테고리 분포 <span className="sub">진행중 142</span></h3></div>
          <div className="row-flex center gap-12">
            <Donut size={84} percent={38} label="38%" sub="상의" />
            <div className="flex-1">
              {[['상의', 38], ['아우터', 24], ['하의', 18], ['신발', 12], ['기타', 8]].map(([l, v], i) => (
                <div key={i} className="row-flex between" style={{ padding: '2px 0' }}>
                  <span style={{ fontSize: 11, color: 'var(--f2)' }}>· {l}</span>
                  <span className="mono dim" style={{ fontSize: 11 }}>{v}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="sec-head"><h3>요일·시간 패턴 <span className="sub">시작 시각</span></h3></div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
            {Array.from({ length: 28 }).map((_, i) => {
              const v = Math.abs(Math.sin(i * 1.3)) * 0.9 + 0.1;
              return <div key={i} style={{ height: 20, background: 'var(--f1)', opacity: v * 0.5, borderRadius: 2 }} />;
            })}
          </div>
          <div className="row-flex between" style={{ marginTop: 6 }}>
            <span className="mono dim" style={{ fontSize: 10 }}>월</span>
            <span className="mono dim" style={{ fontSize: 10 }}>일</span>
          </div>
          <div className="dim mono" style={{ fontSize: 11, marginTop: 6 }}>금·토 18~21시 집중</div>
        </section>

        <section className="panel surface">
          <div className="sec-head"><h3>AI 발견</h3><span className="capsule"><span className="ico" /> auto</span></div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: '19px', color: 'var(--f2)' }}>
            <span className="hs" style={{ fontWeight: 500 }}>여성 20·30대</span>에서 SS24 BIG SALE과 주말 한정 특가가 평균 랭킹 38~78로 강세. 남성 50+ 데님 위크는 약함 — 캠페인 재타겟 권장.
          </p>
        </section>
      </div>
    </>
  );
}
