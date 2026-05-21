'use client';
import React from 'react';
import { IcEdit, IcBell, IcShield, IcPlus } from '@/components/ui/icons';
import Link from 'next/link';

export default function MePage() {
  return (
    <>
      <section className="panel" style={{ padding: 24 }}>
        <div className="row-flex gap-16" style={{ alignItems: 'flex-start' }}>
          <div className="panel compact" style={{ width: 88, height: 88, background: 'var(--snk)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span className="mono" style={{ fontSize: 26, fontWeight: 500 }}>JH</span>
          </div>
          <div className="flex-1">
            <div className="row-flex baseline gap-10">
              <h1 style={{ fontSize: 24, fontWeight: 500, margin: 0 }}>정호철</h1>
              <span className="chip lg" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>admin</span>
              <span className="chip lg">IT팀장</span>
            </div>
            <div className="mono dim" style={{ marginTop: 4, fontSize: 12 }}>zbra@zbra.co.kr · 가입 2025.11 · 마지막 접속 오늘 09:14</div>
            <div className="row-flex gap-6" style={{ marginTop: 12 }}>
              <Link href="/settings" className="btn sm"><IcEdit /> 프로필 편집</Link>
              <Link href="/settings" className="btn sm"><IcBell /> 알림 설정</Link>
              <Link href="/settings" className="btn sm"><IcShield /> 2FA</Link>
            </div>
          </div>
          <div className="col-flex gap-2" style={{ alignItems: 'flex-end' }}>
            <span className="sec-tag">activity score (30d)</span>
            <span className="mono tnum" style={{ fontSize: 28, fontWeight: 500 }}>1,248</span>
            <span className="mono dim" style={{ fontSize: 11 }}>↑ 14% vs 직전 30일</span>
          </div>
        </div>
      </section>

      <div className="grid grid-6 gap-8">
        {[['북마크', '24', '+ 3 (7d)'], ['저장 메모', '18', '+ 2'], ['검색 횟수', '142', '오늘 12'], ['저장 필터', '6', ''], ['활성 알림', '12', '6 영역'], ['해소한 이상', '38', '담당']].map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            <div className="dlt"><span className="muted">{d}</span></div>
          </div>
        ))}
      </div>

      <div className="grid grid-2 gap-14">
        <div className="col-flex gap-12">
          <section className="panel">
            <div className="sec-head">
              <h3>최근 본 <span className="sub">최근 14일</span></h3>
              <button className="btn sm">전체 ↗</button>
            </div>
            {[
              ['상품', '커버낫 시그니처 로고 스웻셔츠', '오늘 09:42', '/product'],
              ['브랜드', '커버낫', '오늘 09:38', '/brand'],
              ['회사', '코웰패션', '오늘 09:32', '/company'],
              ['랭킹', '여 20대 상의 · DAILY', '어제 18:14', '/ranking'],
              ['리뷰', '자사 베이직 라운드 티', '어제 14:42', '/reviews'],
              ['이상탐지', '가격 −30% 스파이크', '어제 11:18', '/anomaly'],
              ['프로모션', 'SS24 BIG SALE 진행 상품', '5/18 16:20', '/promo'],
              ['상품', '아디다스 트레포일 후디', '5/18 14:48', '/product'],
            ].map((r, i) => (
              <Link key={i} href={r[3]} className="row-flex center between" style={{ padding: '9px 6px', borderBottom: i < 7 ? '0.5px dashed var(--bs)' : 'none', cursor: 'pointer', textDecoration: 'none', color: 'inherit', display: 'flex' }}>
                <div className="row-flex center gap-10 flex-1">
                  <span className="mono dim" style={{ fontSize: 10, width: 60 }}>{r[0]}</span>
                  <span style={{ fontSize: 13 }}>{r[1]}</span>
                </div>
                <span className="mono dim" style={{ fontSize: 11 }}>{r[2]}</span>
              </Link>
            ))}
          </section>

          <section className="panel">
            <div className="sec-head">
              <h3>내 메모 <span className="sub">18건 · 최근순</span></h3>
              <button className="btn sm"><IcPlus /> 메모</button>
            </div>
            <div className="col-flex gap-8">
              {[
                ['커버낫 SS24 — 자사 BCV-SWT-001 직접 경쟁. 다음 주 가격 회의 안건.', '오늘 09:42', ['브랜드', '커버낫']],
                ['널디 −30% 스파이크 — 재고 소진 가능성. 데이터 출처 검토 필요.', '어제 11:24', ['상품', '특이점']],
                ['코웰패션 1Q 매출 −18%, 무신사 의존도 상승 — 채널 다각화 시그널.', '5/18 16:42', ['회사', '재무']],
                ['리뷰 분석 — 4월 생산분 사이즈 이슈. 공장 측 확인 요청 발송.', '5/17 14:18', ['리뷰', '품질']],
              ].map((m, i) => (
                <div key={i} className="panel compact" style={{ background: 'var(--snk)' }}>
                  <div style={{ fontSize: 12, color: 'var(--f1)', lineHeight: 1.5 }}>{m[0]}</div>
                  <div className="row-flex between center" style={{ marginTop: 8 }}>
                    <div className="row-flex gap-4">
                      {(m[2] as string[]).map((t, j) => <span key={j} className="chip">{t}</span>)}
                    </div>
                    <span className="mono dim" style={{ fontSize: 10 }}>{m[1]}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="col-flex gap-12">
          <section className="panel">
            <div className="sec-head">
              <h3>북마크 <span className="sub">24건 · 영역별</span></h3>
              <button className="btn sm">관리 ↗</button>
            </div>
            {[
              ['회사', ['코웰패션', 'LF', 'F&F']],
              ['브랜드', ['커버낫', '디스이즈네버댓', '오라리', '널디']],
              ['상품', ['시그니처 스웻 (커버낫)', '체크 머플러 (커버낫)', '트레포일 후디 (아디다스)']],
              ['랭킹', ['여 20대 상의 DAILY', '남 30대 신발 WEEKLY']],
              ['저장 필터', ['이상탐지 · HIGH · 자사', '리뷰 · ★1~2 · 자사']],
            ].map((g, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: i < 4 ? '0.5px dashed var(--bs)' : 'none' }}>
                <div className="sec-tag" style={{ marginBottom: 4 }}>{g[0]}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(g[1] as string[]).map((b, j) => <span key={j} className="chip lg" style={{ cursor: 'pointer' }}>{b}</span>)}
                </div>
              </div>
            ))}
          </section>

          <section className="panel">
            <div className="sec-head">
              <h3>알림 구독 <span className="sub">12개 활성</span></h3>
              <Link href="/settings" className="btn sm">설정 ↗</Link>
            </div>
            {[
              ['일간 요약 (전일 03:30)', '이메일', true],
              ['이상탐지 HIGH (담당 영역)', '이메일 + Slack', true],
              ['이상탐지 MED (담당 영역)', 'Slack', true],
              ['신규 공시 (구독 회사 4)', 'Slack', true],
              ['자사 리뷰 ★1~2', '이메일', true],
              ['랭킹 변동 (북마크 브랜드)', 'Slack', false],
            ].map((n, i) => (
              <div key={i} className="row-flex center gap-10" style={{ padding: '8px 0', borderBottom: i < 5 ? '0.5px dashed var(--bs)' : 'none' }}>
                <span style={{ flex: 1, fontSize: 12, color: n[2] ? 'var(--f1)' : 'var(--f4)' }}>{n[0]}</span>
                <span className="mono dim" style={{ fontSize: 11, width: 120 }}>{n[1]}</span>
                <div className={`toggle ${n[2] ? 'on' : ''}`}><div className="thumb" /></div>
              </div>
            ))}
          </section>

          <section className="panel surface">
            <div className="sec-head"><h3>내 권한 <span className="sub">admin · 전체 영역</span></h3></div>
            <div className="row-flex gap-4 wrap">
              {['홈', '랭킹', '이상탐지', '회사', '브랜드', '상품', '프로모션', '스냅샷', '매거진', '리뷰', '매핑 (admin)', '설정 (admin)'].map((a, i) => (
                <span key={i} className="chip lg">{a}</span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
