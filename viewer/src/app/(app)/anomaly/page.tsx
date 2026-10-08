'use client';
import React from 'react';
import { useSearchParams } from 'next/navigation';
import { useIsMobile } from '@/hooks/useViewport';
import MobileAnomalyView from './MobileAnomalyView';
import { PeriodFilter, FilterBlock, CheckRow, DismissChip } from '@/components/ui/filters';
import { IcDownload, IcBookmark, IcArrowUR, IcX, IcPlus, IcChevL, IcChevR } from '@/components/ui/icons';
import { supabaseBrowser } from '@/lib/supabase/client';
import SavedFiltersDropdown from '@/components/me/SavedFiltersDropdown';
import NoteDrawer from '@/components/me/NoteDrawer';
import { fetchNoteCountForEntity } from '@/lib/queries-me';
import { useAnomalyDateScope } from '@/hooks/useAnomalyDateScope';
import { realCalendarDate } from '@/lib/briefing-anomaly-date';
import { isDailyRankObservation, observationExplanation, prioritySeverity } from '@/lib/anomaly-priority';
import { useAnomalyRecords } from '@/hooks/useAnomalyRecords';

interface ARow {
  id: string;
  detected_at: string;
  detection_date: string;
  module: string;
  severity: string;
  anomaly_type: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  description: string | null;
  meta: Record<string, any> | null;
  // computed
  sev: 'hi' | 'md' | 'lo';
  area: string;
}

const ALL_AREAS = ['상품', '브랜드', '프로모션', '리뷰'];

function sevKey(s: string): 'hi' | 'md' | 'lo' {
  return s === 'high' ? 'hi' : s === 'medium' ? 'md' : 'lo';
}

function areaKey(t: string): string {
  if (t.startsWith('brand_')) return '브랜드';
  if (t.startsWith('rank_') || ['new_entrant_top10', 'sold_out', 'price_drop', 'price_rise'].includes(t)) return '상품';
  if (t === 'promo_heavy_discount') return '프로모션';
  return '리뷰';
}

function formatTs(ts: string): string {
  const kst = new Date(new Date(ts).getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 16).replace('T', ' ').replace(/-/g, '.');
}

function anomalyLabel(t: string): string {
  const map: Record<string, string> = {
    rank_spike:           '순위 급등',
    rank_drop_own:        '자사 순위 이탈',
    new_entrant_top10:    'TOP10 신규 진입',
    sold_out:             '품절 전환',
    price_drop:           '가격 급락',
    promo_heavy_discount: '고할인 프로모션',
    review_count_surge:   '리뷰 폭증',
    review_rating_drop:   '별점 급락',
    review_negative_surge:'부정 리뷰 급증',
  };
  return map[t] || t;
}

function eventLabel(row: ARow): string {
  const m = row.meta || {};
  switch (row.anomaly_type) {
    case 'rank_spike':
      return `순위 ↑${m.delta}계단 (${m.rank_prev}위→${m.rank_today}위)`;
    case 'new_entrant_top10':
      return `TOP10 진입 (오늘 ${m.rank_today}위)`;
    case 'rank_drop_own':
      return `순위 ↓${Math.abs(m.delta ?? 0)}계단 (${m.rank_prev}위→${m.rank_today}위)`;
    case 'price_drop':
      return `가격 -${Math.round((m.drop_rate ?? 0) * 100)}% (${(m.price_prev ?? 0).toLocaleString()}→${(m.price_today ?? 0).toLocaleString()}원)`;
    case 'promo_heavy_discount':
      return `프로모션 할인율 ${m.discount_rate}%`;
    case 'review_count_surge':
      return `리뷰 폭증 ×${m.multiplier} (오늘 ${m.count_today}건)`;
    default:
      return row.description || anomalyLabel(row.anomaly_type);
  }
}

function MetaMetrics({ row }: { row: ARow }) {
  const m = row.meta || {};
  const cells: [string, string][] = [];

  switch (row.anomaly_type) {
    case 'rank_spike':
      cells.push(['어제 순위', m.rank_prev != null ? `${m.rank_prev}위` : '미집계']);
      cells.push(['오늘 순위', `${m.rank_today}위`]);
      cells.push(['급등폭', `↑${m.delta}계단`]);
      break;
    case 'new_entrant_top10':
      cells.push(['어제 순위', m.rank_prev != null ? `${m.rank_prev}위` : '미진입']);
      cells.push(['오늘 순위', `${m.rank_today}위`]);
      cells.push(['브랜드', m.brand || '—']);
      break;
    case 'price_drop':
      cells.push(['이전 가격', m.price_prev != null ? `${(m.price_prev as number).toLocaleString()}원` : '—']);
      cells.push(['현재 가격', m.price_today != null ? `${(m.price_today as number).toLocaleString()}원` : '—']);
      cells.push(['하락률', m.drop_rate != null ? `${Math.round((m.drop_rate as number) * 100)}%` : '—']);
      break;
    case 'promo_heavy_discount':
      cells.push(['할인율', `${m.discount_rate}%`]);
      cells.push(['최종 가격', m.final_price != null ? `${(m.final_price as number).toLocaleString()}원` : '—']);
      cells.push(['브랜드', m.brand || '—']);
      break;
    case 'review_count_surge':
      cells.push(['오늘 리뷰', `${m.count_today}건`]);
      cells.push(['30일 일평균', `${m.daily_avg_30}건`]);
      cells.push(['배율', `×${m.multiplier}`]);
      break;
    case 'review_rating_drop':
      cells.push(['이전 평점', m.rating_prev != null ? `${m.rating_prev}점` : '—']);
      cells.push(['현재 평점', m.rating_today != null ? `${m.rating_today}점` : '—']);
      cells.push(['하락폭', m.drop != null ? `▼${m.drop}` : '—']);
      break;
    default:
      Object.entries(m).slice(0, 3).forEach(([k, v]) => cells.push([k, String(v)]));
  }

  if (cells.length === 0) return null;
  return (
    <div className="grid grid-3 gap-8">
      {cells.map(([l, v]) => (
        <div key={l} className="kpi" style={{ padding: '10px 12px' }}>
          <span className="label">{l}</span>
          <div className="val" style={{ fontSize: 18 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function AnomalyDrawer({ item, onClose, onPrev, onNext }: {
  item: ARow;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [noteOpen,   setNoteOpen]   = React.useState(false);
  const [noteCount,  setNoteCount]  = React.useState(0);
  const [entityLink, setEntityLink] = React.useState<string | null>(null);

  React.useEffect(() => {
    setNoteOpen(false);
    setEntityLink(null);
    let active = true;
    setNoteCount(0);
    fetchNoteCountForEntity('anomaly', item.id).then(count => { if (active) setNoteCount(count); }).catch(() => {});

    if (!item.entity_id || !item.entity_type) return () => { active = false; };
    if (item.entity_type === 'brand') {
      setEntityLink(`/brand?id=${item.entity_id}`);
    } else if (item.entity_type === 'product') {
      const table = item.anomaly_type === 'promo_heavy_discount' ? 'promotion_items' : 'products';
      supabaseBrowser()
        .from(table)
        .select('musinsa_no')
        .eq('id', item.entity_id)
        .single()
        .then(({ data }) => {
          if (active && data?.musinsa_no) setEntityLink(`/product?no=${data.musinsa_no}`);
        }, () => {});
    }
    return () => { active = false; };
  // item.id 변경 시에만 재조회 — entity_id·table은 항상 item.id와 함께 변경됨
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 100 }} onClick={onClose} />
      <aside className="drawer" style={{ zIndex: 110 }}>
        <div className="drawer-head">
          <div className="row-flex center gap-8">
            <span className={`sev ${sevKey(item.severity)}`}><span className="pip" />기록된 {item.severity.toUpperCase()}</span>
            <span className="sec-tag">{item.area}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{formatTs(item.detected_at)}</span>
          </div>
          <button className="btn sm icon" onClick={onClose} title="닫기"><IcX /></button>
        </div>

        <div className="drawer-body">
          {observationExplanation(item) && <p>{observationExplanation(item)}</p>}
          <div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--f4)', marginBottom: 4 }}>
              {anomalyLabel(item.anomaly_type)}
            </div>
            <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0, letterSpacing: '-0.018em', lineHeight: 1.5 }}>
              {item.description || eventLabel(item)}
            </h2>
            {item.entity_name && (
              <div className="row-flex baseline gap-8" style={{ marginTop: 6 }}>
                <span className="sec-tag">target</span>
                {entityLink ? (
                  <a href={entityLink} style={{ fontSize: 13, color: 'var(--hs)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                    {item.entity_name}
                    <IcArrowUR size={11} />
                  </a>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--f2)' }}>{item.entity_name}</span>
                )}
              </div>
            )}
          </div>

          <section className="panel compact">
            <div className="sec-head"><h3>핵심 지표</h3></div>
            <MetaMetrics row={item} />
          </section>

          <section>
            <div className="sec-head"><h3>이벤트 히스토리</h3></div>
            <div className="timeline">
              {[
                [formatTs(item.detected_at), item.sev, `자동 감지 — ${anomalyLabel(item.anomaly_type)}`],
                [item.detection_date, 'lo', `수집 기준일`],
              ].map(([t, sv, body]: any, i) => (
                <div key={i} className={`tl-item ${sv}`}>
                  <span className="time">{t}</span>
                  <span className="dot" />
                  <span className="body">{body}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="drawer-foot">
          <button className="btn sm icon" onClick={onPrev}><IcChevL /></button>
          <button className="btn sm icon" onClick={onNext}><IcChevR /></button>
          <div className="flex-1" />
          <button className="btn sm" onClick={() => setNoteOpen(true)} style={{ position: 'relative' }}>
            <IcPlus /> 메모
            {noteCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                minWidth: 14, height: 14, borderRadius: 7, padding: '0 3px',
                background: 'var(--hs)', color: 'var(--bg)',
                fontSize: 9, fontFamily: 'var(--mono)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, pointerEvents: 'none',
              }}>
                {noteCount}
              </span>
            )}
          </button>
        </div>
      </aside>

      <NoteDrawer
        entity_type="anomaly"
        entity_id={item.id}
        entity_label={item.entity_name ?? anomalyLabel(item.anomaly_type)}
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        onCountChange={setNoteCount}
      />
    </>
  );
}

function AnomalyPage() {
  const params  = useSearchParams();
  const jumpId  = params.get('id') ?? '';
  const urlDate = realCalendarDate(params.get('date'));

  const { period, setPeriod, fromDate, setFromDate, toDate, setToDate, from, to }
    = useAnomalyDateScope(params.get('date'));

  const detailIntent = React.useRef(0);
  const invalidatePendingDetail = React.useCallback(() => { detailIntent.current++; }, []);
  const [sev, setSev] = React.useState(new Set(['hi', 'md', 'lo']));
  React.useEffect(() => {
    const p = params.get('sev');
    invalidatePendingDetail();
    setSev(new Set(p && ['hi', 'md', 'lo'].includes(p) ? [p] : ['hi', 'md', 'lo']));
  }, [params, invalidatePendingDetail]);
  const [area,   setArea]   = React.useState(new Set(ALL_AREAS));
  const [detailRecord, setDetailRecord] = React.useState<{ scope: string; item: ARow } | null>(null);

  const records = useAnomalyRecords(from, to);
  const rows: ARow[] = records.rows.map(r => ({ ...r, sev: prioritySeverity(r), area: areaKey(r.anomaly_type) }));
  const { loading, error: errMsg } = records;
  const detailScope = JSON.stringify([from, to, records.identityKey, jumpId]);
  const currentDetailScope = React.useRef(detailScope);
  currentDetailScope.current = detailScope;
  const detail = detailRecord?.scope === detailScope ? detailRecord.item : null;
  const setDetail = React.useCallback((next: ARow | null) => {
    setDetailRecord(next ? { scope: currentDetailScope.current, item: next } : null);
  }, []);
  const chooseDetail = (next: ARow | null) => {
    if (currentDetailScope.current !== detailScope) return;
    invalidatePendingDetail(); setDetail(next);
  };
  const [observationsOpen, setObservationsOpen] = React.useState(false);
  React.useEffect(() => { invalidatePendingDetail(); setDetail(null); setObservationsOpen(false); }, [from, to, records.identityKey, invalidatePendingDetail, setDetail]);
  React.useEffect(() => {
    setDetail(null);
    if (!jumpId || !records.identity) return;
    let active = true;
    const ownIntent = ++detailIntent.current;
    const ownScope = currentDetailScope.current;
    let query = supabaseBrowser().from('anomalies')
      .select('id, detected_at, detection_date, module, severity, anomaly_type, entity_type, entity_id, entity_name, description, meta')
      .eq('id', jumpId);
    if (urlDate) query = query.eq('detection_date', urlDate);
    query.single().then(({ data }) => {
        if (active && ownIntent === detailIntent.current && currentDetailScope.current === ownScope && data
            && (!urlDate || data.detection_date === urlDate)) {
          setDetail({ ...data, sev: prioritySeverity(data), area: areaKey(data.anomaly_type) });
          if (isDailyRankObservation(data)) setObservationsOpen(true);
        }
      }, () => {});
    return () => { active = false; };
  }, [jumpId, records.identity, records.identityKey, urlDate, setDetail]);

  const toggleSev = (k: string) => { invalidatePendingDetail(); setSev(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; }); };
  const toggleArea = (k: string) => { invalidatePendingDetail(); setArea(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; }); };

  const filtered = rows.filter(r => {
    if (!sev.has(r.sev))   return false;
    if (!area.has(r.area)) return false;
    return true;
  });

  const sevCount  = (k: string) => rows.filter(r => r.sev === k).length;
  const areaCount = (k: string) => rows.filter(r => r.area === k).length;

  const periodLabel = period === 'today' ? '오늘' : period === '7d' ? '7일' :
    period === '30d' ? '30일' : period === '90d' ? '90일' : `${fromDate} ~ ${toDate}`;

  const reset = () => {
    invalidatePendingDetail();
    setPeriod('7d');
    setSev(new Set(['hi', 'md', 'lo']));
    setArea(new Set(ALL_AREAS));
  };

  const handleLoadFilter = (filter: unknown) => {
    invalidatePendingDetail();
    const f = filter as any;
    if (f.period !== undefined)    setPeriod(f.period);
    if (f.fromDate !== undefined)  setFromDate(f.fromDate);
    if (f.toDate !== undefined)    setToDate(f.toDate);
    if (Array.isArray(f.sev))      setSev(new Set(f.sev));
    if (Array.isArray(f.area))     setArea(new Set(f.area));
  };

  return (
    <>
      <div className="page-title">
        <h1>이상탐지</h1>
        <span className="chip mono">{periodLabel}</span>
        <span className="sub">자동 발견된 특이점 — 영역·심각도로 필터</span>
        <div className="row-flex gap-6" style={{ marginLeft: 'auto' }}>
          <button className="btn sm"><IcDownload /> CSV</button>
          <button className="btn sm"><IcBookmark /> 필터 저장</button>
        </div>
      </div>

      <div className="grid grid-4 gap-8">
        {([
          ['불러온 기록',   loading ? '…' : String(rows.length),                                              periodLabel],
          ['HIGH',   loading ? '…' : String(sevCount('hi')),                                           '일일 순위 관측 제외 · 불러온 기록 기준'],
          ['상품기획',loading ? '…' : String(rows.filter(r => r.module === 'product_planning').length), ''],
          ['CS',     loading ? '…' : String(rows.filter(r => r.module === 'cs').length),               ''],
        ] as [string, string, string][]).map(([l, v, d], i) => (
          <div key={i} className="kpi">
            <span className="label">{l}</span>
            <div className="val">{v}</div>
            {d && <div className="dlt"><span className="muted">{d}</span></div>}
          </div>
        ))}
      </div>

      {errMsg && (
        <div style={{ padding: '12px 16px', borderRadius: 7, background: 'var(--shb)', color: 'var(--shf)', fontSize: 13 }}>
          데이터 로드 실패: {errMsg}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '280px 1fr', gap: 14 }}>
        <aside className="filter-rail">
          <div className="frh">
            <h3>필터</h3>
            <button className="btn sm" onClick={reset}>초기화</button>
          </div>
          <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--bs)' }}>
            <SavedFiltersDropdown
              page="/anomaly"
              currentFilter={{
                period, fromDate, toDate,
                sev: [...sev], area: [...area],
              }}
              onLoad={handleLoadFilter}
            />
          </div>
          <div className="frb">
            <PeriodFilter
              value={period} onChange={value => { invalidatePendingDetail(); setPeriod(value); }}
              from={fromDate} to={toDate}
              onFromChange={value => { invalidatePendingDetail(); setFromDate(value); }} onToChange={value => { invalidatePendingDetail(); setToDate(value); }}
              options={[
                ['today',  '오늘'],
                ['7d',     '7일'],
                ['30d',    '30일'],
                ['90d',    '90일'],
                ['custom', '직접'],
              ]}
            />

            <FilterBlock label="심각도" hint={`${sev.size}/3`}>
              {([['hi', 'HIGH'], ['md', 'MED'], ['lo', 'LOW']] as [string, string][]).map(([k, l]) => (
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
          </div>
        </aside>

        <div className="col-flex gap-10">
          <div className="row-flex center gap-6 wrap">
            <span className="sec-tag">applied</span>
            <DismissChip onDismiss={() => { invalidatePendingDetail(); setPeriod('7d'); }}>{periodLabel}</DismissChip>
            {[...sev].map(s => (
              <DismissChip key={s} onDismiss={() => toggleSev(s)}>
                <span className={`sev ${s}`}><span className="pip" />{s.toUpperCase()}</span>
              </DismissChip>
            ))}
            {area.size < ALL_AREAS.length && (
              <DismissChip onDismiss={() => { invalidatePendingDetail(); setArea(new Set(ALL_AREAS)); }}>
                영역 {area.size}/{ALL_AREAS.length}
              </DismissChip>
            )}
            <div className="flex-1" />
            <span className="mono dim" style={{ fontSize: 12 }}>{filtered.length}건 표시 / 불러온 {rows.length}건</span>
          </div>

          <section className="panel" style={{ padding: 0 }}>
            <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
              <div className="row head" style={{ gridTemplateColumns: '130px 60px 70px 1fr 220px 46px' }}>
                <span>시각</span>
                <span>sev</span>
                <span>영역</span>
                <span>이벤트</span>
                <span>대상</span>
                <span></span>
              </div>

              {loading && (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--f4)' }}>
                  <span className="mono dim">로딩 중…</span>
                </div>
              )}

              {(!loading || rows.length > 0) && ([false, true] as const).map(observations => {
                const items = filtered.filter(r => isDailyRankObservation(r) === observations);
                return <details key={String(observations)} open={observations ? observationsOpen : true}
                  onToggle={event => { if (observations) setObservationsOpen(event.currentTarget.open); }}>
                  <summary style={{ padding: '12px 16px', cursor: 'pointer' }}>
                    {observations ? '일일 순위 관측' : '우선 확인'} · 불러온 기록 중 {items.length}건
                  </summary>
                                {items.map((r, i) => (
                <div key={r.id}
                  className={`row hover ${i % 2 ? 'alt' : ''}`}
                  style={{ gridTemplateColumns: '130px 60px 70px 1fr 220px 46px', cursor: 'pointer' }}
                  onClick={() => chooseDetail(r)}
                >
                  <span className="mono dim" style={{ fontSize: 11 }}>{formatTs(r.detected_at)}</span>
                  <span><span className={`sev ${r.sev}`}><span className="pip" />{isDailyRankObservation(r) ? '관측' : r.sev.toUpperCase()}</span></span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--f2)' }}>{r.area}</span>
                  <span style={{ fontSize: 12 }}>{observationExplanation(r) || eventLabel(r)}</span>
                  <span className="muted ellip" style={{ fontSize: 12 }}>{r.entity_name || '—'}</span>
                  <span>
                    <button className="btn sm icon" onClick={e => { e.stopPropagation(); chooseDetail(r); }}>
                      <IcArrowUR />
                    </button>
                  </span>
                </div>
              ))}

                </details>;
              })}

              {!loading && !errMsg && filtered.length === 0 && (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--f4)' }}>
                  <span className="sec-tag">no results</span>
                  <div style={{ marginTop: 8, fontSize: 12 }}>{records.hasMore ? '불러온 기록에는 조건에 맞는 항목이 없습니다. 아직 확인하지 않은 기록이 있습니다.' : '선택한 기간의 기록을 모두 불러왔으며 조건에 맞는 항목이 없습니다.'}</div>
                </div>
              )}
            </div>
          </section>
          {records.hasMore && <><p>일부 기록만 불러왔습니다. 필터 결과와 건수는 불러온 기록 기준입니다.</p><button className="btn" disabled={loading} onClick={records.loadMore}>{filtered.length === 0 ? '다음 기록에서 조건 계속 확인' : '더 보기'}</button></>}
          {errMsg && <button className="btn" disabled={loading} onClick={records.retry}>다시 시도</button>}
        </div>
      </div>

      {detail && (
        <AnomalyDrawer
          item={detail}
          onClose={() => chooseDetail(null)}
          onPrev={() => {
            const i = filtered.findIndex(row => row.id === detail.id);
            if (i > 0) chooseDetail(filtered[i - 1]);
          }}
          onNext={() => {
            const i = filtered.findIndex(row => row.id === detail.id);
            if (i >= 0 && i < filtered.length - 1) chooseDetail(filtered[i + 1]);
          }}
        />
      )}
    </>
  );
}

function AnomalyPageRootInner() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileAnomalyView />;
  return (
    <React.Suspense>
      <AnomalyPage />
    </React.Suspense>
  );
}

export default function AnomalyPageRoot() {
  return (
    <React.Suspense>
      <AnomalyPageRootInner />
    </React.Suspense>
  );
}
