'use client';
import React from 'react';
import { IcFlag } from '@/components/ui/icons';
import {
  fetchDetectorRules,
  updateDetectorRule,
  createDetectorRule,
  deleteDetectorRule,
  type DetectorRule,
  type RuleSeverity,
} from '@/lib/queries-admin';
import { useIsMobile } from '@/hooks/useViewport';
import MobileAdminAnomaliesView from './MobileAdminAnomaliesView';
import { fmtDateTime } from '@/lib/format';

// ── 파라미터 팔레트 정의 ────────────────────────────────────────────────────────
// 제안 목록일 뿐 — 여기 없는 키도 자유롭게 추가 가능

const PALETTE = [
  { key: 'delta',         label: '변동폭',       desc: '순위·점수가 N 이상 변동',         default: 20,   min: 1,    max: 300,  step: 1    },
  { key: 'rate',          label: '비율',         desc: '변화율  (0.1 = 10%)',             default: 0.10, min: 0.01, max: 1,    step: 0.01 },
  { key: 'top',           label: 'TOP 순위',     desc: 'TOP N 이내 진입 조건',            default: 10,   min: 1,    max: 300,  step: 1    },
  { key: 'prev_out',      label: '이전 순위 밖', desc: '어제 N위 밖이었던 조건',          default: 20,   min: 1,    max: 500,  step: 1    },
  { key: 'threshold',     label: '임계값',       desc: '점수·편차 임계 (별점 등)',         default: 0.3,  min: 0.01, max: 10,   step: 0.01 },
  { key: 'multiplier',    label: '배율',         desc: '평균 대비 N배 기준',              default: 3.0,  min: 1.0,  max: 30,   step: 0.1  },
  { key: 'min_count',     label: '최소 개수',    desc: '동시 발생 최소 건수',             default: 3,    min: 1,    max: 100,  step: 1    },
  { key: 'min_rank',      label: '최소 순위',    desc: 'TOP N 이내에서만 적용',           default: 50,   min: 1,    max: 500,  step: 1    },
  { key: 'helpful_min',   label: 'helpful 최소', desc: '공감 수 최솟값',                  default: 10,   min: 1,    max: 500,  step: 1    },
  { key: 'drop_rate',     label: '감소율',       desc: '전일 대비 감소 비율  (0.3 = 30%)', default: 0.30, min: 0.01, max: 1,    step: 0.01 },
  { key: 'diverge',       label: '편차',         desc: '두 값 사이 차이 기준',            default: 20,   min: 1,    max: 200,  step: 1    },
  { key: 'min_daily_avg', label: '일평균 최소',  desc: '30일 일평균 최솟값',              default: 1.0,  min: 0.1,  max: 100,  step: 0.1  },
] as const;

type PaletteItem = (typeof PALETTE)[number];

// ── helpers ────────────────────────────────────────────────────────────────────

let _seq = 0;
const nextId = () => String(++_seq);

interface ParamRow {
  id:      string;
  key:     string;
  numVal:  number;
  preset?: PaletteItem;
}

const SEV_CLASS: Record<RuleSeverity, string> = { high: 'hi', medium: 'md', low: 'lo' };
const SEV_KO:    Record<RuleSeverity, string> = { high: '높음', medium: '보통', low: '낮음' };

function paramsChips(params: Record<string, unknown>): string {
  const e = Object.entries(params);
  if (!e.length) return '—';
  return e.map(([k, v]) =>
    k === 'rate' && typeof v === 'number' && v < 1
      ? `${k} = ${Math.round(v * 100)}%`
      : `${k} = ${v}`
  ).join('  ·  ');
}

function slugify(s: string): string {
  return s.trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button onClick={() => !disabled && onChange(!checked)} style={{
      width: 34, height: 20, borderRadius: 10, border: 'none', flexShrink: 0,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      background: checked ? 'var(--hs)' : 'var(--snk)', position: 'relative',
      transition: 'background 180ms',
    }}>
      <span style={{
        position: 'absolute', top: 3, left: checked ? 17 : 3,
        width: 14, height: 14, borderRadius: '50%',
        background: checked ? 'var(--white)' : 'var(--bd)', transition: 'left 180ms',
      }} />
    </button>
  );
}

// ── Edit Modal (슬라이더 or JSON fallback) ─────────────────────────────────────

function EditModal({ rule, onClose, onSaved }: {
  rule: DetectorRule; onClose: () => void; onSaved: (r: DetectorRule) => void;
}) {
  const [label,    setLabel]    = React.useState(rule.label);
  const [severity, setSeverity] = React.useState<RuleSeverity>(rule.severity);
  const [desc,     setDesc]     = React.useState(rule.description ?? '');
  const [rawJson,  setRawJson]  = React.useState(JSON.stringify(rule.params, null, 2));
  const [jsonErr,  setJsonErr]  = React.useState<string | null>(null);
  const [saving,   setSaving]   = React.useState(false);
  const [err,      setErr]      = React.useState<string | null>(null);

  // Build slider rows for known palette keys
  const rows = React.useMemo<ParamRow[]>(() => {
    return Object.entries(rule.params).map(([k, v]) => {
      const preset = PALETTE.find(p => p.key === k);
      return { id: nextId(), key: k, numVal: typeof v === 'number' ? v : 0, preset };
    });
  }, [rule.params]);

  const [sliders, setSliders] = React.useState<Record<string, number>>(
    () => Object.fromEntries(rows.map(r => [r.id, r.numVal]))
  );

  // Sync sliders → rawJson
  React.useEffect(() => {
    const p: Record<string, unknown> = {};
    rows.forEach(r => { p[r.key] = sliders[r.id] ?? r.numVal; });
    setRawJson(JSON.stringify(p, null, 2));
    setJsonErr(null);
  // sliders 변경 시에만 rawJson 동기화. rows·setters 안정 참조
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliders]);

  const handleSave = async () => {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(rawJson); } catch { setJsonErr('JSON 형식 오류'); return; }
    setSaving(true);
    const { error } = await updateDetectorRule(rule.id, { label, severity, description: desc || null, params: parsed });
    setSaving(false);
    if (error) { setErr(error); return; }
    onSaved({ ...rule, label, severity, description: desc || null, params: parsed });
    onClose();
  };

  const hasKnownParams = rows.some(r => r.preset);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 12, padding: 24, width: 460, maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{rule.label}</div>
            <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2 }}>{rule.detector_key}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--f3)', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--f3)' }}>룰 이름</label>
          <input value={label} onChange={e => setLabel(e.target.value)}
            style={{ background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 12px', fontSize: 13, color: 'var(--f1)' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--f3)' }}>심각도</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['high', 'medium', 'low'] as RuleSeverity[]).map(s => (
              <button key={s} onClick={() => setSeverity(s)}
                className={severity === s ? `sev ${SEV_CLASS[s]}` : 'btn sm'}
                style={{ flex: 1, cursor: 'pointer', fontSize: 11, padding: '5px 0', textAlign: 'center' }}>
                {SEV_KO[s]}
              </button>
            ))}
          </div>
        </div>

        {/* 파라미터: 알려진 키는 슬라이더, 나머지는 JSON */}
        {hasKnownParams ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--f3)' }}>파라미터</label>
            {rows.map(r => r.preset ? (
              <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 11, color: 'var(--f2)', fontWeight: 500 }}>{r.key}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--hs)', fontFamily: 'var(--mono)' }}>{sliders[r.id] ?? r.numVal}</span>
                </div>
                <input type="range" min={r.preset.min} max={r.preset.max} step={r.preset.step}
                  value={sliders[r.id] ?? r.numVal}
                  onChange={e => setSliders(p => ({ ...p, [r.id]: Number(e.target.value) }))}
                  style={{ width: '100%', accentColor: 'var(--hs)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'var(--f4)' }}>{r.preset.min}</span>
                  <span style={{ fontSize: 10, color: 'var(--f4)' }}>{r.preset.max}</span>
                </div>
              </div>
            ) : (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--f3)', fontFamily: 'var(--mono)', minWidth: 100 }}>{r.key}</span>
                <input type="number" value={sliders[r.id] ?? r.numVal}
                  onChange={e => setSliders(p => ({ ...p, [r.id]: Number(e.target.value) }))}
                  style={{ flex: 1, background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 4, padding: '4px 8px', fontSize: 12, color: 'var(--f1)', fontFamily: 'var(--mono)' }} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--f3)' }}>파라미터 (JSON)</label>
            <textarea value={rawJson} rows={5}
              onChange={e => {
                setRawJson(e.target.value);
                try { JSON.parse(e.target.value); setJsonErr(null); } catch { setJsonErr('JSON 형식 오류'); }
              }}
              style={{ background: 'var(--snk)', border: `1px solid ${jsonErr ? 'var(--shf)' : 'var(--bd)'}`, borderRadius: 6, padding: '7px 12px', fontSize: 11, color: 'var(--f1)', resize: 'vertical', fontFamily: 'var(--mono)' }} />
            {jsonErr && <span style={{ fontSize: 10, color: 'var(--shf)' }}>{jsonErr}</span>}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--f3)' }}>설명</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
            style={{ background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 12px', fontSize: 12, color: 'var(--f1)', resize: 'none', fontFamily: 'inherit' }} />
        </div>

        {err && <span style={{ fontSize: 11, color: 'var(--shf)' }}>{err}</span>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn sm" onClick={onClose}>취소</button>
          <button className="btn sm brand" onClick={handleSave} disabled={saving || !!jsonErr}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rule Builder Modal — 자유 조립 방식 ───────────────────────────────────────

function RuleBuilderModal({ onClose, onCreated, customCount }: {
  onClose: () => void;
  onCreated: (r: DetectorRule) => void;
  customCount: number;
}) {
  const [step,       setStep]       = React.useState<1 | 2 | 3>(1);

  // Step 1
  const [name,     setName]     = React.useState('');
  const [severity, setSeverity] = React.useState<RuleSeverity>('medium');

  // Step 2 — param builder
  const [rows,      setRows]      = React.useState<ParamRow[]>([]);
  const [dragging,  setDragging]  = React.useState<string | null>(null);   // palette key
  const [dropOver,  setDropOver]  = React.useState(false);
  const [rawMode,   setRawMode]   = React.useState(false);
  const [rawJson,   setRawJson]   = React.useState('{}');
  const [jsonErr,   setJsonErr]   = React.useState<string | null>(null);

  // Step 3
  const [detKey,  setDetKey]  = React.useState('');
  const [detDesc, setDetDesc] = React.useState('');
  const [saving,  setSaving]  = React.useState(false);
  const [err,     setErr]     = React.useState<string | null>(null);

  // Auto-generate detector key from name
  React.useEffect(() => {
    if (name) setDetKey(`custom_${slugify(name)}`);
  }, [name]);

  // Sync rows → rawJson when not in raw mode
  React.useEffect(() => {
    if (rawMode) return;
    const p: Record<string, unknown> = {};
    rows.forEach(r => { if (r.key) p[r.key] = r.numVal; });
    setRawJson(JSON.stringify(p, null, 2));
    setJsonErr(null);
  }, [rows, rawMode]);

  const addFromPalette = (item: PaletteItem) => {
    if (rows.find(r => r.key === item.key)) return; // no duplicates
    setRows(prev => [...prev, { id: nextId(), key: item.key, numVal: item.default, preset: item }]);
  };

  const addCustomRow = () => {
    setRows(prev => [...prev, { id: nextId(), key: '', numVal: 0 }]);
  };

  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));

  const updateRow = (id: string, patch: Partial<ParamRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const key = dragging ?? e.dataTransfer.getData('pk');
    const item = PALETTE.find(p => p.key === key);
    if (item) addFromPalette(item);
  };

  const paramsForCreate = (): Record<string, unknown> | null => {
    if (rawMode) {
      try { return JSON.parse(rawJson); } catch { return null; }
    }
    const p: Record<string, unknown> = {};
    for (const r of rows) {
      if (!r.key.trim()) continue;
      p[r.key.trim()] = r.numVal;
    }
    return p;
  };

  const handleCreate = async () => {
    if (!name.trim())   { setErr('룰 이름을 입력하세요'); return; }
    if (!detKey.trim()) { setErr('탐지 키를 입력하세요'); return; }
    const params = paramsForCreate();
    if (!params) { setJsonErr('JSON 형식 오류'); return; }
    setSaving(true);
    const { rule, error } = await createDetectorRule({
      detector_key: detKey.trim(),
      label:        name.trim(),
      severity,
      params,
      description:  detDesc || undefined,
    });
    setSaving(false);
    if (error) { setErr(error); return; }
    if (rule) onCreated(rule);
    onClose();
  };

  const stepLabel = ['기본 정보', '파라미터 설계', '탐지 키 · 확인'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 14, padding: 28, width: 580, maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>새 탐지 룰 만들기</div>
            <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>{step} / 3 — {stepLabel[step - 1]}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {([1, 2, 3] as const).map(s => (
                <div key={s} style={{
                  height: 4, borderRadius: 2,
                  width: s === step ? 28 : 12,
                  background: s < step ? 'color-mix(in srgb, var(--hs) 45%, transparent)' : s === step ? 'var(--hs)' : 'var(--snk)',
                  transition: 'all 220ms',
                }} />
              ))}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--f3)', fontSize: 18, lineHeight: 1, padding: 2 }}>✕</button>
          </div>
        </div>

        {/* ── STEP 1: 기본 정보 ── */}
        {step === 1 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--f2)' }}>
                룰 이름 <span style={{ color: 'var(--shf)' }}>*</span>
              </label>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && name.trim()) setStep(2); }}
                placeholder="예: 급격한 가격 하락 + 품절 동시 발생"
                style={{ background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 8, padding: '11px 14px', fontSize: 14, color: 'var(--f1)' }}
              />
              <span style={{ fontSize: 10, color: 'var(--f4)' }}>탐지 키는 다음 단계에서 자동 생성됩니다</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--f2)' }}>심각도</label>
              <div style={{ display: 'flex', gap: 10 }}>
                {(['high', 'medium', 'low'] as RuleSeverity[]).map(s => (
                  <button key={s} onClick={() => setSeverity(s)} style={{
                    flex: 1, padding: '12px 0', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    border: `2px solid ${severity === s ? 'currentColor' : 'var(--bd)'}`,
                    transition: 'all 150ms',
                    ...(severity === s
                      ? { background: s === 'high' ? 'var(--shb)' : s === 'medium' ? 'var(--smb)' : 'var(--slb)',
                          color:      s === 'high' ? 'var(--shf)' : s === 'medium' ? 'var(--smf)' : 'var(--slf)' }
                      : { background: 'var(--bg)', color: 'var(--f3)' }),
                  }}>
                    {SEV_KO[s]}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn sm brand" onClick={() => setStep(2)} disabled={!name.trim()}>
                다음 — 파라미터 설계 →
              </button>
            </div>
          </>
        )}

        {/* ── STEP 2: 파라미터 설계 ── */}
        {step === 2 && (
          <>
            {/* 팔레트 헤더 */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>파라미터를 자유롭게 조립하세요</div>
              <div style={{ fontSize: 11, color: 'var(--f4)' }}>
                아래 칩을 드래그하거나 클릭해서 추가 · 직접 키를 입력해도 됩니다
              </div>
            </div>

            {/* 팔레트 칩들 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(PALETTE as readonly PaletteItem[]).map(item => {
                const already = rows.some(r => r.key === item.key);
                return (
                  <div key={item.key}
                    draggable={!already}
                    onDragStart={e => { e.dataTransfer.setData('pk', item.key); setDragging(item.key); }}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => !already && addFromPalette(item)}
                    title={item.desc}
                    style={{
                      padding: '5px 11px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                      border: '1px solid var(--bd)', userSelect: 'none',
                      cursor: already ? 'default' : dragging === item.key ? 'grabbing' : 'grab',
                      background: already ? 'var(--hs-soft)' : 'var(--sur)',
                      color:      already ? 'var(--hs)' : 'var(--f2)',
                      borderColor: already ? 'var(--hs)' : 'var(--bd)',
                      opacity: dragging && dragging !== item.key ? 0.35 : 1,
                      transform: dragging === item.key ? 'scale(1.06) rotate(-1deg)' : 'none',
                      transition: 'opacity 130ms, transform 130ms',
                    }}
                  >
                    {already ? '✓ ' : ''}{item.label}
                    <span style={{ fontSize: 9, color: already ? 'var(--hs)' : 'var(--f4)', marginLeft: 4, fontFamily: 'var(--mono)' }}>{item.key}</span>
                  </div>
                );
              })}
            </div>

            {/* 드롭존 + 파라미터 목록 */}
            <div
              onDragOver={e => { e.preventDefault(); setDropOver(true); }}
              onDragLeave={() => setDropOver(false)}
              onDrop={handleDrop}
              style={{
                minHeight: 180, borderRadius: 10, padding: 14,
                border: `2px dashed ${dropOver ? 'var(--hs)' : rows.length ? 'transparent' : 'var(--bd)'}`,
                background: dropOver ? 'color-mix(in srgb, var(--hs) 7%, transparent)' : 'var(--snk)',
                transition: 'all 150ms',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}
            >
              {rows.length === 0 && !dropOver && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '20px 0' }}>
                  <span style={{ fontSize: 28 }}>⬆️</span>
                  <span style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center' }}>
                    위 칩을 드래그하거나 클릭해서 파라미터를 추가하세요<br />
                    <span style={{ fontSize: 11, color: 'var(--f4)' }}>또는 아래 버튼으로 원하는 키를 직접 입력</span>
                  </span>
                </div>
              )}
              {dropOver && rows.length === 0 && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--hs)', fontWeight: 600 }}>놓으세요!</span>
                </div>
              )}

              {/* 파라미터 행 */}
              {rows.map(r => (
                <div key={r.id} style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* 키 입력 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '0 0 140px' }}>
                      <span style={{ fontSize: 9, color: 'var(--f4)' }}>파라미터 키</span>
                      <input
                        value={r.key}
                        onChange={e => updateRow(r.id, { key: e.target.value, preset: PALETTE.find(p => p.key === e.target.value) })}
                        placeholder="key 이름"
                        style={{ background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 4, padding: '4px 8px', fontSize: 11, color: 'var(--f1)', fontFamily: 'var(--mono)', width: '100%' }}
                      />
                    </div>
                    {/* 값 입력 */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 9, color: 'var(--f4)' }}>값</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="number"
                          value={r.numVal}
                          step={r.preset?.step ?? 1}
                          onChange={e => updateRow(r.id, { numVal: Number(e.target.value) })}
                          style={{ width: 72, background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 4, padding: '4px 8px', fontSize: 12, color: 'var(--f1)', fontFamily: 'var(--mono)', fontWeight: 600 }}
                        />
                        {r.preset && (
                          <span style={{ fontSize: 10, color: 'var(--f4)' }}>
                            {r.preset.min} – {r.preset.max}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 삭제 */}
                    <button onClick={() => removeRow(r.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--f4)', fontSize: 16, padding: '0 4px', alignSelf: 'flex-end', marginBottom: 2 }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--shf)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--f4)')}
                    >×</button>
                  </div>

                  {/* 슬라이더 (preset만) */}
                  {r.preset && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="range" min={r.preset.min} max={r.preset.max} step={r.preset.step}
                        value={r.numVal}
                        onChange={e => updateRow(r.id, { numVal: Number(e.target.value) })}
                        style={{ flex: 1, accentColor: 'var(--hs)', height: 4 }} />
                    </div>
                  )}

                  {r.preset && (
                    <div style={{ fontSize: 10, color: 'var(--f4)', fontStyle: 'italic' }}>{r.preset.desc}</div>
                  )}
                </div>
              ))}
            </div>

            {/* 액션 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn sm ghost" onClick={addCustomRow} style={{ fontSize: 11 }}>
                + 파라미터 직접 추가
              </button>
              <button className="btn sm" onClick={() => setRawMode(v => !v)} style={{ fontSize: 11 }}>
                {rawMode ? '빌더 모드' : 'JSON 직접 입력'}
              </button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn sm" onClick={() => setStep(1)}>← 이전</button>
                <button className="btn sm brand" onClick={() => setStep(3)}>다음 →</button>
              </div>
            </div>

            {/* Raw JSON 모드 */}
            {rawMode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 11, color: 'var(--f3)' }}>파라미터 JSON 직접 입력</label>
                <textarea value={rawJson} rows={6}
                  onChange={e => {
                    setRawJson(e.target.value);
                    try { JSON.parse(e.target.value); setJsonErr(null); } catch { setJsonErr('JSON 형식 오류'); }
                  }}
                  style={{ background: 'var(--snk)', border: `1px solid ${jsonErr ? 'var(--shf)' : 'var(--bd)'}`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--f1)', resize: 'vertical', fontFamily: 'var(--mono)' }} />
                {jsonErr && <span style={{ fontSize: 10, color: 'var(--shf)' }}>{jsonErr}</span>}
              </div>
            )}

            {/* Live JSON preview (빌더 모드) */}
            {!rawMode && rows.length > 0 && (
              <div style={{ background: 'var(--snk)', borderRadius: 8, padding: '8px 12px' }}>
                <span style={{ fontSize: 9, color: 'var(--f4)', display: 'block', marginBottom: 3 }}>JSON 미리보기</span>
                <code style={{ fontSize: 11, color: 'var(--f3)', fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{rawJson}</code>
              </div>
            )}
          </>
        )}

        {/* ── STEP 3: 탐지 키 + 확인 ── */}
        {step === 3 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--f2)' }}>
                탐지 키 (detector_key) <span style={{ color: 'var(--shf)' }}>*</span>
              </label>
              <input value={detKey} onChange={e => setDetKey(e.target.value)}
                style={{ background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--f1)', fontFamily: 'var(--mono)' }} />
              <span style={{ fontSize: 10, color: 'var(--f4)' }}>
                워커가 이 키를 읽어 어떤 로직을 실행할지 결정합니다. 자동 생성됐으며 수정 가능합니다.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--f2)' }}>탐지 조건 설명</label>
              <textarea value={detDesc} onChange={e => setDetDesc(e.target.value)}
                placeholder="어떤 상황에서 이 룰이 발동되는지 간략히 기술하세요"
                rows={3}
                style={{ background: 'var(--snk)', border: '1px solid var(--bd)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--f1)', resize: 'none', fontFamily: 'inherit' }} />
            </div>

            {/* 최종 요약 카드 */}
            <div style={{ background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--f4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>생성될 룰</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--f1)', flex: 1 }}>{name || '—'}</span>
                <span className={`sev ${SEV_CLASS[severity]}`} style={{ fontSize: 11 }}>
                  <span className="pip" />{severity}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>{detKey || '—'}</div>
              {rawJson !== '{}' && (
                <code style={{ fontSize: 11, color: 'var(--f3)', fontFamily: 'var(--mono)', background: 'var(--snk)', padding: '6px 10px', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {rawJson}
                </code>
              )}
              {detDesc && <div style={{ fontSize: 11, color: 'var(--f3)', lineHeight: 1.5 }}>{detDesc}</div>}
            </div>

            {err && <span style={{ fontSize: 11, color: 'var(--shf)' }}>{err}</span>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn sm" onClick={() => setStep(2)}>← 이전</button>
              <button className="btn sm brand" onClick={handleCreate} disabled={saving || !name.trim() || !detKey.trim()}>
                {saving ? '생성 중…' : '룰 생성 ✓'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Rule Row ────────────────────────────────────────────────────────────────────

function RuleRow({ rule, index, toggling, onToggle, onEdit, onDelete }: {
  rule: DetectorRule; index: number; toggling: boolean;
  onToggle: (r: DetectorRule) => void;
  onEdit:   (r: DetectorRule) => void;
  onDelete: (r: DetectorRule) => void;
}) {
  const isCustom = rule.module === 'custom';
  return (
    <div className={`row${index % 2 ? ' alt' : ''}`}
      style={{ gridTemplateColumns: '48px 1fr 80px 90px 72px', opacity: rule.enabled ? 1 : 0.5, transition: 'opacity 200ms' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Toggle checked={rule.enabled} onChange={() => onToggle(rule)} disabled={toggling} />
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.label}</span>
          {isCustom && <span className="chip" style={{ fontSize: 9, flexShrink: 0 }}>커스텀</span>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.detector_key}</div>
        {Object.keys(rule.params).length > 0 && (
          <div style={{ fontSize: 10, color: 'var(--f3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{paramsChips(rule.params)}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span className={`sev ${SEV_CLASS[rule.severity]}`} style={{ fontSize: 10 }}>
          <span className="pip" />{rule.severity}
        </span>
      </div>
      <span className="mono dim" style={{ fontSize: 9, alignSelf: 'center' }}>{fmtDateTime(rule.updated_at)}</span>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button onClick={() => onEdit(rule)} className="btn sm" style={{ fontSize: 10, padding: '2px 8px' }}>편집</button>
        {isCustom && (
          <button onClick={() => onDelete(rule)} className="btn sm danger" style={{ fontSize: 10, padding: '2px 8px' }}>삭제</button>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminAnomaliesPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileAdminAnomaliesView />;
  return <AdminAnomaliesDesktopView />;
}

function AdminAnomaliesDesktopView() {
  const [rules,      setRules]      = React.useState<DetectorRule[]>([]);
  const [loading,    setLoading]    = React.useState(true);
  const [apiErr,     setApiErr]     = React.useState<string | null>(null);
  const [toggling,   setToggling]   = React.useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = React.useState<DetectorRule | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setApiErr(null);
    try {
      const res = await fetch('/api/admin/anomalies/rules');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setApiErr(body.error ?? `HTTP ${res.status}`);
        setRules([]);
      } else {
        const { rules: data } = await res.json();
        setRules(data ?? []);
      }
    } catch (e) { setApiErr(String(e)); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const handleToggle = async (rule: DetectorRule) => {
    const next = !rule.enabled;
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: next } : r));
    setToggling(s => new Set(s).add(rule.id));
    const { error } = await updateDetectorRule(rule.id, { enabled: next });
    setToggling(s => { const n = new Set(s); n.delete(rule.id); return n; });
    if (error) setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: rule.enabled } : r));
  };

  const handleDelete = async (rule: DetectorRule) => {
    if (!confirm(`"${rule.label}" 룰을 삭제하시겠습니까?`)) return;
    const { error } = await deleteDetectorRule(rule.id);
    if (!error) setRules(prev => prev.filter(r => r.id !== rule.id));
  };

  const customCount  = rules.filter(r => r.module === 'custom').length;
  const enabledCount = rules.filter(r => r.enabled).length;

  return (
    <>
      <div className="page-title">
        <IcFlag size={18} style={{ color: 'var(--hs)' }} />
        <h1>이상탐지 룰</h1>
        <span className="chip" style={{ fontSize: 10, background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>admin</span>
        <button className="btn sm brand" style={{ marginLeft: 'auto' }} onClick={() => setShowCreate(true)}>+ 새 룰</button>
        <button className="btn sm" onClick={load}>↺</button>
      </div>

      <div className="grid grid-4 gap-8">
        {([['전체 룰', rules.length, '개'], ['활성 중', enabledCount, '개'], ['비활성', rules.length - enabledCount, '개'], ['커스텀', customCount, '개']] as [string, number, string][])
          .map(([label, val, unit], i) => (
            <div key={i} className="kpi">
              <span className="label">{label}</span>
              <div className="val">{val}<span className="unit"> {unit}</span></div>
            </div>
          ))}
      </div>

      {apiErr && (
        <div className="panel" style={{ background: 'var(--shb)', borderColor: 'var(--shf)', padding: '14px 18px' }}>
          <div style={{ fontSize: 12, color: 'var(--shf)', fontWeight: 600, marginBottom: 4 }}>API 오류</div>
          <div style={{ fontSize: 11, color: 'var(--shf)', fontFamily: 'var(--mono)' }}>{apiErr}</div>
          <div style={{ fontSize: 11, color: 'var(--f2)', marginTop: 8 }}>
            테이블이 없으면 <code style={{ fontFamily: 'var(--mono)', background: 'rgba(0,0,0,0.1)', padding: '1px 4px', borderRadius: 3 }}>01100_detector_rules.sql</code> 마이그레이션을 실행하세요.
          </div>
        </div>
      )}

      <section className="panel" style={{ padding: 0 }}>
        <div className="tbl" style={{ border: 'none', borderRadius: 0 }}>
          <div className="row head" style={{ gridTemplateColumns: '48px 1fr 80px 90px 72px' }}>
            <span>활성</span><span>룰 이름</span><span>심각도</span><span>수정일</span><span></span>
          </div>
          {loading && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--f4)', fontSize: 12, fontFamily: 'var(--mono)' }}>불러오는 중…</div>
          )}
          {!loading && !apiErr && rules.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--f3)', marginBottom: 6 }}>룰이 없습니다</div>
              <div style={{ fontSize: 11, color: 'var(--f4)' }}>마이그레이션을 적용하면 22개 기본 룰이 등록됩니다.</div>
            </div>
          )}
          {!loading && rules.map((rule, i) => (
            <RuleRow key={rule.id} rule={rule} index={i}
              toggling={toggling.has(rule.id)}
              onToggle={handleToggle}
              onEdit={setEditTarget}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </section>

      {!loading && rules.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--f4)', margin: 0 }}>
          변경 사항은 DB에 즉시 저장되며, 워커의 다음 수집 사이클부터 적용됩니다. 기본 제공 룰은 파라미터·심각도·활성화 여부만 수정 가능합니다.
        </p>
      )}

      {editTarget && (
        <EditModal rule={editTarget} onClose={() => setEditTarget(null)}
          onSaved={u => setRules(prev => prev.map(r => r.id === u.id ? u : r))} />
      )}
      {showCreate && (
        <RuleBuilderModal onClose={() => setShowCreate(false)}
          onCreated={r => setRules(prev => [...prev, r])}
          customCount={customCount} />
      )}
    </>
  );
}
