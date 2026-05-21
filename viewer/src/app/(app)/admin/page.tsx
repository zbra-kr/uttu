'use client';
import React from 'react';
import { HBar } from '@/components/ui/charts';
import { IcSearch, IcShield, IcDownload, IcCheck, IcX } from '@/components/ui/icons';

const COMPANIES: [string, string, string, boolean, string][] = [
  ['코웰패션', '033290', '의복·신발 도소매', true, '시그니처 스웻 매출 비중 큼'],
  ['LF', '093050', '의류 제조 · 도소매', false, ''],
  ['F&F', '383220', '의류 도소매', false, ''],
  ['신세계인터내셔날', '031430', '의류·잡화 도소매', false, ''],
  ['한세실업', '105630', '의류 OEM', false, ''],
  ['형지I&C', '011080', '의류 제조', false, ''],
  ['브랜드엑스코퍼레이션', '337930', '의류 도소매', false, ''],
  ['아센디오', '012170', '의류·잡화', false, ''],
];

const BRANDS: [string, number, string][] = [
  ['커버낫', 92, '시그니처 스웻 · 카고 팬츠'],
  ['디스이즈네버댓', 88, '로고 티 · 옥스포드 셔츠'],
  ['오라리', 84, '니트 카디건'],
  ['인사일런스', 80, '오버사이즈 티'],
  ['LMC', 24, '키워드 일치 낮음'],
  ['에스피오나지', 18, ''],
  ['파르티멘토', 14, ''],
];

export default function AdminPage() {
  const [coIdx, setCoIdx] = React.useState(0);
  const [brSel, setBrSel] = React.useState<Record<number, boolean>>({ 0: true, 1: true, 2: true, 3: true });

  return (
    <>
      <div className="page-title">
        <h1>공시 ↔ 브랜드 매핑</h1>
        <span className="chip" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}><IcShield /> admin</span>
        <span className="sub">DART 회사와 무신사 브랜드를 수동 매핑 — AI 추천 + 키워드 필터</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <button className="btn sm"><IcDownload /> CSV</button>
        </div>
      </div>

      <div className="grid grid-5 gap-8">
        {[['DART 회사 (수집)', '142', '+ 3 신규'], ['무신사 브랜드 (수집)', '1,402', '+ 12'], ['매핑 완료', '38', '+ 2'], ['매핑 보류', '8', 'AI 제안 대기'], ['미매핑 회사', '96', '브랜드 없음']].map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
      </div>

      <div className="row-flex gap-6 center">
        <button className="btn sm active">매핑 필요 (8)</button>
        <button className="btn sm">완료</button>
        <button className="btn sm">전체</button>
        <div className="flex-1" />
        <div className="input row-flex center gap-6" style={{ width: 260 }}>
          <IcSearch style={{ color: 'var(--f4)' }} />
          <span style={{ color: 'var(--f4)', fontSize: 12 }}>회사명 / 브랜드명 검색</span>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 110px 1fr', gap: 14 }}>
        <section className="panel">
          <div className="sec-head"><h3>회사 — DART 공시 <span className="sub">AI 제안 순 · 매핑 대기 8</span></h3></div>
          <div className="col-flex gap-6">
            {COMPANIES.map((c, i) => {
              const on = i === coIdx;
              return (
                <div key={i} className={`map-card ${on ? 'on' : ''}`} onClick={() => setCoIdx(i)}>
                  <div className="row-flex between baseline">
                    <span style={{ fontSize: 13, fontWeight: on ? 500 : 400 }}>{c[0]}</span>
                    <span className="mono dim" style={{ fontSize: 11 }}>{c[1]}</span>
                  </div>
                  <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>{c[2]}</div>
                  {on && c[4] && (
                    <div className="panel compact" style={{ marginTop: 6, background: 'var(--rai)' }}>
                      <span className="sec-tag">notes</span>
                      <div style={{ fontSize: 11, color: 'var(--f2)', marginTop: 2 }}>{c[4]}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="col-flex center" style={{ justifyContent: 'center', gap: 14 }}>
          <span className="mono dim" style={{ fontSize: 11 }}>매핑 →</span>
          <div style={{ width: 72, height: 72, borderRadius: 36, background: 'var(--snk)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="mono" style={{ fontSize: 26, color: 'var(--f1)' }}>⤳</span>
          </div>
          <button className="btn primary"><IcCheck /> 매핑 저장</button>
          <button className="btn sm"><IcX /> 해제</button>
          <hr className="hr-d" style={{ width: '100%' }} />
          <span className="mono dim" style={{ fontSize: 10, textAlign: 'center', lineHeight: 1.5 }}>회사 1 ⇌ 브랜드 N<br />다중 선택 가능</span>
        </div>

        <section className="panel">
          <div className="sec-head">
            <h3>브랜드 — 무신사 <span className="sub">AI 추천 + 키워드 필터</span></h3>
            <div className="input" style={{ width: 140, height: 26, fontSize: 11 }}>
              <span style={{ color: 'var(--f4)', fontSize: 11 }}>키워드 필터</span>
            </div>
          </div>
          <div className="col-flex gap-4">
            {BRANDS.map((b, i) => {
              const on = !!brSel[i];
              return (
                <div key={i} className={`map-card ${on ? 'on' : ''}`}
                  style={{ opacity: b[1] < 30 && !on ? 0.55 : 1, cursor: 'pointer' }}
                  onClick={() => setBrSel(s => ({ ...s, [i]: !s[i] }))}>
                  <div className="row-flex between center">
                    <div className="row-flex center gap-8">
                      <div className={`checkbox ${on ? 'on' : ''}`}>{on && '✓'}</div>
                      <span style={{ fontSize: 13, fontWeight: on ? 500 : 400 }}>{b[0]}</span>
                    </div>
                    <div className="row-flex center gap-6">
                      <HBar value={b[1]} max={100} accent={b[1] >= 70} w={56} />
                      <span className="mono dim" style={{ fontSize: 10, width: 28, textAlign: 'right' }}>{b[1]}%</span>
                    </div>
                  </div>
                  {b[2] && <div className="mono dim" style={{ fontSize: 11, marginTop: 4, marginLeft: 22 }}>↳ {b[2]}</div>}
                </div>
              );
            })}
            <div style={{ padding: '6px 10px' }}>
              <span className="dim mono" style={{ fontSize: 11 }}>··· 18 more</span>
            </div>
          </div>
        </section>
      </div>

      <section className="panel compact row-flex center gap-14">
        <span className="sec-tag">최근 매핑</span>
        <span className="chip lg">코웰패션 ⤳ 커버낫 외 3</span>
        <span className="mono dim" style={{ fontSize: 11 }}>05.19 · 정호철</span>
        <span className="chip lg">LF ⤳ 헤지스 외 2</span>
        <span className="mono dim" style={{ fontSize: 11 }}>05.18</span>
        <div className="flex-1" />
        <button className="btn sm">매핑 히스토리 ↗</button>
      </section>
    </>
  );
}
