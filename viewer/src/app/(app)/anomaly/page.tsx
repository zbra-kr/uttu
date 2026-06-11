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

const ALL_AREAS = ['상품', '프로모션', '리뷰'];

function sevKey(s: string): 'hi' | 'md' | 'lo' {
  return s === 'high' ? 'hi' : s === 'medium' ? 'md' : 'lo';
}

function areaKey(t: string): string {
  if (['rank_spike', 'new_entrant_top10', 'rank_drop_own', 'sold_out', 'price_drop'].includes(t)) return '상품';
  if (t === 'promo_heavy_discount') return '프로모션';
  return '리뷰';
}

function kstToday(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function kstDaysAgo(n: number): string {
  const d = new Date(Date.now() + 9 * 3_600_000);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
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

function computeDateRange(period: string, fromDate: string, toDate: string) {
  const today = kstToday();
  if (period === 'today') return { from: today,          to: today };
  if (period === '7d')    return { from: kstDaysAgo(6),  to: today };
  if (period === '30d')   return { from: kstDaysAgo(29), to: today };
  if (period === '90d')   return { from: kstDaysAgo(89), to: today };
  return { from: fromDate, to: toDate };
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
    fetchNoteCountForEntity('anomaly', item.id).then(setNoteCount);

    if (!item.entity_id || !item.entity_type) return;
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
          if (data?.musinsa_no) setEntityLink(`/product?no=${data.musinsa_no}`);
        });
    }
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 100 }} onClick={onClose} />
      <aside className="drawer" style={{ zIndex: 110 }}>
        <div className="drawer-head">
          <div className="row-flex center gap-8">
            <span className={`sev ${item.sev}`}><span className="pip" />{item.sev.toUpperCase()}</span>
            <span className="sec-tag">{item.area}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{formatTs(item.detected_at)}</span>
          </div>
          <button className="btn sm icon" onClick={onClose} title="닫기"><IcX /></button>
        </div>

        <div className="drawer-body">
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

  const [period,   setPeriod]   = React.useState('today');
  const [fromDate, setFromDate] = React.useState(() => kstDaysAgo(6));
  const [toDate,   setToDate]   = React.useState(kstToday);

  const [sev, setSev] = React.useState(new Set(['hi', 'md', 'lo']));
  React.useEffect(() => {
    const p = params.get('sev');
    if (p && ['hi', 'md', 'lo'].includes(p)) setSev(new Set([p]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [area,   setArea]   = React.useState(new Set(ALL_AREAS));
  const [detail, setDetail] = React.useState<ARow | null>(null);

  const [rows,    setRows]    = React.useState<ARow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [errMsg,  setErrMsg]  = React.useState<string | null>(null);

  const jumpedRef = React.useRef(false);

  React.useEffect(() => {
    if (!jumpId || jumpedRef.current) return;
    supabaseBrowser()
      .from('anomalies')
      .select('id, detected_at, detection_date, module, severity, anomaly_type, entity_type, entity_id, entity_name, description, meta')
      .eq('id', jumpId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        jumpedRef.current = true;
        const row: ARow = { ...data, sev: sevKey(data.severity), area: areaKey(data.anomaly_type) };
        setSev(new Set(['hi', 'md', 'lo']));
        setDetail(row);
      });
  }, [jumpId]);

  React.useEffect(() => {
    const { from, to } = computeDateRange(period, fromDate, toDate);
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setErrMsg(null);
      const { data, error } = await supabaseBrowser()
        .from('anomalies')
        .select('id, detected_at, detection_date, module, severity, anomaly_type, entity_type, entity_id, entity_name, description, meta')
        .gte('detection_date', from)
        .lte('detection_date', to)
        .order('detected_at', { ascending: false })
        .limit(500);

      if (cancelled) return;
      if (error) { setErrMsg(error.message); setLoading(false); return; }

      setRows((data ?? []).map(r => ({
        ...r,
        sev:  sevKey(r.severity),
        area: areaKey(r.anomaly_type),
      })));
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [period, fromDate, toDate]);

  const toggleSev  = (k: string) => setSev(p  => { const n = new Set(p);  n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleArea = (k: string) => setArea(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

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
    setPeriod('7d');
    setSev(new Set(['hi', 'md', 'lo']));
    setArea(new Set(ALL_AREAS));
  };

  const handleLoadFilter = (filter: unknown) => {
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
          ['전체',   loading ? '…' : String(rows.length),                                              periodLabel],
          ['HIGH',   loading ? '…' : String(sevCount('hi')),                                           '심각 신호'],
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
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--shb)', color: 'var(--shf)', fontSize: 13 }}>
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
              value={period} onChange={setPeriod}
              from={fromDate} to={toDate}
              onFromChange={setFromDate} onToChange={setToDate}
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
            <div className="flex-1" />
            <span className="mono dim" style={{ fontSize: 12 }}>{filtered.length}건 / {rows.length}</span>
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

              {!loading && filtered.map((r, i) => (
                <div key={r.id}
                  className={`row hover ${i % 2 ? 'alt' : ''}`}
                  style={{ gridTemplateColumns: '130px 60px 70px 1fr 220px 46px', cursor: 'pointer' }}
                  onClick={() => setDetail(r)}
                >
                  <span className="mono dim" style={{ fontSize: 11 }}>{formatTs(r.detected_at)}</span>
                  <span><span className={`sev ${r.sev}`}><span className="pip" />{r.sev.toUpperCase()}</span></span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--f2)' }}>{r.area}</span>
                  <span style={{ fontSize: 12 }}>{eventLabel(r)}</span>
                  <span className="muted ellip" style={{ fontSize: 12 }}>{r.entity_name || '—'}</span>
                  <span>
                    <button className="btn sm icon" onClick={e => { e.stopPropagation(); setDetail(r); }}>
                      <IcArrowUR />
                    </button>
                  </span>
                </div>
              ))}

              {!loading && filtered.length === 0 && (
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
            const i = filtered.indexOf(detail);
            if (i > 0) setDetail(filtered[i - 1]);
          }}
          onNext={() => {
            const i = filtered.indexOf(detail);
            if (i < filtered.length - 1) setDetail(filtered[i + 1]);
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
