'use client';
import React from 'react';
import { Spark, Line } from '@/components/ui/charts';
import { IcShield, IcMore } from '@/components/ui/icons';

export default function SettingsPage() {
  const [section, setSection] = React.useState('profile');

  const nav = [
    ['profile', '개인정보'],
    ['notif', '알림'],
    ['conn', '연결 (DB·API)'],
    ['jobs', '수집 작업'],
  ] as [string, string][];

  return (
    <div className="grid" style={{ gridTemplateColumns: '220px 1fr', gap: 14 }}>
      <aside className="panel" style={{ padding: 12, height: 'fit-content' }}>
        <span className="sec-tag" style={{ display: 'block', marginBottom: 8 }}>설정</span>
        {nav.map(([id, t], i) => (
          <div key={i} onClick={() => setSection(id)}
            style={{ padding: '8px 10px', background: section === id ? 'var(--snk)' : 'transparent', border: '0.5px solid ' + (section === id ? 'var(--bs)' : 'transparent'), borderRadius: 5, marginBottom: 2, cursor: 'pointer', fontSize: 12, fontWeight: section === id ? 500 : 400, color: section === id ? 'var(--f1)' : 'var(--f2)' }}>
            {t}
          </div>
        ))}
      </aside>

      <div className="col-flex gap-14">
        {section === 'profile' && <SettingsProfile />}
        {section === 'jobs' && <PageJobs />}
        {section !== 'profile' && section !== 'jobs' && (
          <section className="panel" style={{ minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6 }}>
            <span className="sec-tag">section</span>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{section}</div>
            <span className="dim mono" style={{ fontSize: 11 }}>이 섹션은 별도 화면에서 다룹니다 (스코프 외)</span>
          </section>
        )}
      </div>
    </div>
  );
}

function SettingsProfile() {
  return (
    <>
      <h2 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>개인정보</h2>
      <section className="panel">
        <div className="row-flex gap-14" style={{ alignItems: 'flex-start' }}>
          <div className="panel compact" style={{ width: 92, height: 92, background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span className="mono" style={{ fontSize: 26, fontWeight: 500 }}>JH</span>
          </div>
          <div className="flex-1">
            <div className="sec-head"><h3>기본</h3></div>
            <div className="grid grid-2 gap-12">
              {[['이름', '정호철'], ['직책', 'IT팀장'], ['이메일', 'zbra@zbra.co.kr'], ['연락처', '+82-10-XXXX-XXXX']].map(([k, v], i) => (
                <div key={i}>
                  <span className="field-lbl">{k}</span>
                  <div className="input mono">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="sec-head"><h3>비밀번호 <span className="sub">마지막 변경 2026.02.14</span></h3></div>
        <div className="grid grid-3 gap-12">
          {[['현재', '••••••••••'], ['새 비밀번호', ''], ['확인', '']].map(([k, v], i) => (
            <div key={i}>
              <span className="field-lbl">{k}</span>
              <div className="input">{v ? <span className="mono">{v}</span> : <span style={{ color: 'var(--f4)', fontSize: 12 }}>입력</span>}</div>
            </div>
          ))}
        </div>
        <div className="row-flex gap-6" style={{ marginTop: 14 }}>
          <button className="btn primary">변경</button>
          <button className="btn"><IcShield /> 2FA 설정</button>
        </div>
      </section>

      <section className="panel">
        <div className="sec-head"><h3>알림 <span className="sub">기본은 일간 요약 · 이상탐지 HIGH는 즉시</span></h3></div>
        {[['일간 요약 (전일 03:30)', '이메일', true], ['이상탐지 HIGH', '이메일 + Slack', true], ['이상탐지 MED', 'Slack', true], ['이상탐지 LOW', '오프', false], ['신규 공시 (구독 회사)', 'Slack', true], ['자사 리뷰 ★1~2', '이메일', true]].map((n, i) => (
          <div key={i} className="row-flex center gap-10" style={{ padding: '8px 0', borderBottom: i < 5 ? '0.5px dashed var(--bs)' : 'none' }}>
            <span style={{ flex: 1, fontSize: 12 }}>{n[0]}</span>
            <span className="mono dim" style={{ width: 140, fontSize: 11 }}>{n[1]}</span>
            <div className={`toggle ${n[2] ? 'on' : ''}`}><div className="thumb" /></div>
          </div>
        ))}
      </section>
    </>
  );
}

function PageJobs() {
  const jobs: [string, string, string, string, string, string][] = [
    ['ranking.job', 'OK', '03:01', '12.4k', '14m12s', '12 OK, 0 fail'],
    ['product.job', 'OK', '03:08', '1.8k', '8m04s', '12 OK, 0 fail'],
    ['event.job', 'OK', '03:11', '142', '3m08s', '12 OK, 0 fail'],
    ['review.job', 'OK', '03:13', '184', '2m38s', '11 OK, 1 retry'],
    ['erp.job', 'OK', '03:14', '284', '1m22s', '12 OK, 0 fail'],
    ['dart.job', 'WARN', '03:14', '3', '0m28s', '10 OK, 2 warn'],
    ['snap.job', 'OK', '03:09', '38', '5m12s', '12 OK, 0 fail'],
    ['magazine.job', 'OK', '03:10', '4', '0m48s', '12 OK, 0 fail'],
  ];

  return (
    <div className="col-flex gap-14">
      <h2 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>수집 작업</h2>

      <div className="grid grid-4 gap-8">
        {[['오늘 실행', '8', '03:00~03:14'], ['성공', '7', ''], ['경고/실패', '1', 'dart.job'], ['평균 실행 시간', '4m24s', '직전 7일']].map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="sec-head">
          <h3>오늘의 실행 현황 <span className="sub">cron · 03:00 KST</span></h3>
          <div className="row-flex gap-4">
            <button className="btn sm">로그 보기</button>
            <button className="btn sm">⟳ 새로고침</button>
          </div>
        </div>
        <div className="tbl">
          <div className="row head" style={{ gridTemplateColumns: '160px 80px 90px 80px 100px 1fr 70px 60px' }}>
            <span>job</span><span>상태</span><span>완료 시각</span><span className="cell-r">레코드</span><span className="cell-r">실행 시간</span><span>최근 7일</span><span className="cell-r">평균</span><span></span>
          </div>
          {jobs.map((j, i) => (
            <div key={i} className={`row hover ${i % 2 ? 'alt' : ''}`} style={{ gridTemplateColumns: '160px 80px 90px 80px 100px 1fr 70px 60px' }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--f1)' }}>{j[0]}</span>
              <span><span className={`sev ${j[1] === 'OK' ? 'lo' : 'md'}`}><span className="pip" />{j[1]}</span></span>
              <span className="mono dim">{j[2]}</span>
              <span className="mono muted cell-r">{j[3]}</span>
              <span className="mono muted cell-r">{j[4]}</span>
              <span><Spark w={120} h={18} up={i % 3 !== 1} /></span>
              <span className="mono muted cell-r">{j[4].split('m')[0]}m</span>
              <span><button className="btn sm icon"><IcMore /></button></span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-2 gap-12">
        <section className="panel">
          <div className="sec-head"><h3>실행 추이 <span className="sub">전체 작업 · 14일</span></h3></div>
          <Line h={120} yMin={0} yMax={20} series={[
            { points: [12, 13, 14, 14, 13, 14, 14, 14, 13, 14, 14, 14, 14, 14], color: 'var(--tu)' },
            { points: [2, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1], color: 'var(--shf)' },
          ]} />
          <div className="row-flex gap-14" style={{ marginTop: 8 }}>
            <span className="row-flex center gap-4"><span style={{ width: 14, height: 2, background: 'var(--tu)' }} /><span className="mono dim" style={{ fontSize: 10 }}>성공</span></span>
            <span className="row-flex center gap-4"><span style={{ width: 14, height: 2, background: 'var(--shf)' }} /><span className="mono dim" style={{ fontSize: 10 }}>경고/실패</span></span>
          </div>
        </section>

        <section className="panel">
          <div className="sec-head"><h3>현재 진행중인 알림</h3></div>
          <div className="row-flex gap-8" style={{ padding: '10px 12px', background: 'var(--smb)', borderRadius: 6, border: '0.5px solid var(--smf)' }}>
            <span className="sev md"><span className="pip" />WARN</span>
            <div className="flex-1">
              <div style={{ fontSize: 13, fontWeight: 500 }}>dart.job — 일부 종목 응답 지연</div>
              <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>10/12 OK, 2 종목 retry queue. 자동 재시도 03:30 예정</div>
            </div>
            <button className="btn sm">상세</button>
          </div>
          <div style={{ marginTop: 12, padding: 12, background: 'var(--snk)', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--f3)', lineHeight: 1.6 }}>
            {'[03:14:28] dart.job: starting batch 2/2 (8 tickers)'}<br />
            {'[03:14:32] dart.job: 033290 OK · 142KB'}<br />
            {'[03:14:38] dart.job: 105630 TIMEOUT · retry queued'}<br />
            {'[03:14:42] dart.job: 6/8 OK · marked WARN'}
          </div>
        </section>
      </div>
    </div>
  );
}
