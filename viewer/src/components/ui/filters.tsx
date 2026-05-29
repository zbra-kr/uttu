'use client';
import React from 'react';
import { IcSearch } from './icons';

interface SegGroupProps {
  value: string;
  onChange: (v: string) => void;
  options: [string, string, (number | null)?][];
  full?: boolean;
}
export const SegGroup = ({ value, onChange, options, full = true }: SegGroupProps) => (
  <div className={`seg ${full ? 'full' : ''}`}>
    {options.map(([k, label, count]) => (
      <button key={k} className={`seg-btn ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>
        {label}
        {count != null && <span className="count">{count}</span>}
      </button>
    ))}
  </div>
);

interface PeriodFilterProps {
  value: string;
  onChange: (v: string) => void;
  from?: string;
  to?: string;
  onFromChange?: (v: string) => void;
  onToChange?: (v: string) => void;
  options?: [string, string][];
}
const DEFAULT_PERIOD_OPTIONS: [string, string][] = [
  ['today',  '오늘'],
  ['all',    '전체'],
  ['7d',     '7일'],
  ['30d',    '30일'],
  ['90d',    '90일'],
  ['custom', '직접'],
];
export const PeriodFilter = ({ value, onChange, from, to, onFromChange, onToChange, options }: PeriodFilterProps) => (
  <div className="fblock">
    <div className="field-lbl-row">
      <span className="field-lbl">기간</span>
      {value === 'custom' && from && to && (
        <span className="mono dim" style={{ fontSize: 10 }}>{from} ~ {to}</span>
      )}
    </div>
    <SegGroup value={value} onChange={onChange} options={options ?? DEFAULT_PERIOD_OPTIONS} />
    {value === 'custom' && (
      <div className="daterange">
        <input type="date" className="input-date" value={from} onChange={(e) => onFromChange?.(e.target.value)} />
        <span className="mono dim" style={{ fontSize: 11 }}>~</span>
        <input type="date" className="input-date" value={to} onChange={(e) => onToChange?.(e.target.value)} />
      </div>
    )}
  </div>
);

interface CheckRowProps { on: boolean; onToggle: () => void; label: React.ReactNode; count?: number; prefix?: React.ReactNode; }
export const CheckRow = ({ on, onToggle, label, count, prefix }: CheckRowProps) => (
  <div className={`check-row ${on ? 'on' : ''}`} onClick={onToggle}>
    <div className={`checkbox ${on ? 'on' : ''}`}>{on && '✓'}</div>
    {prefix}
    <span className="lbl">{label}</span>
    {count != null && <span className="count">{count}</span>}
  </div>
);

interface FilterBlockProps { label: string; hint?: string; children: React.ReactNode; }
export const FilterBlock = ({ label, hint, children }: FilterBlockProps) => (
  <div className="fblock">
    <div className="field-lbl-row">
      <span className="field-lbl">{label}</span>
      {hint && <span className="mono dim" style={{ fontSize: 10 }}>{hint}</span>}
    </div>
    {children}
  </div>
);

interface PillGroupProps { value: string; onChange: (v: string) => void; options: [string, string][]; }
export const PillGroup = ({ value, onChange, options }: PillGroupProps) => (
  <div className="pill-group">
    {options.map(([k, label]) => (
      <button key={k} className={`pill ${value === k ? 'on' : ''}`} onClick={() => onChange(k)}>{label}</button>
    ))}
  </div>
);

interface DismissChipProps { children: React.ReactNode; onDismiss: () => void; style?: React.CSSProperties; }
export const DismissChip = ({ children, onDismiss, style }: DismissChipProps) => (
  <span className="chip lg dismiss" style={style}>
    {children}
    <span className="x" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>×</span>
  </span>
);

interface SearchSelectProps {
  options: string[];
  selected: Set<string>;
  onAdd: (o: string) => void;
  onRemove: (o: string) => void;
  placeholder?: string;
  meta?: Record<string, string>;
}
export const SearchSelect = ({ options, selected, onAdd, onRemove, placeholder, meta }: SearchSelectProps) => {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = options.filter(o => !selected.has(o) && (!q || o.toLowerCase().includes(q)));

  const add = (o: string) => { onAdd(o); setQuery(''); };

  return (
    <div className="ss" ref={containerRef}>
      <div className="ss-input">
        <span style={{ color: 'var(--f4)', flexShrink: 0 }}><IcSearch /></span>
        <input
          type="text"
          placeholder={placeholder || '검색하여 추가'}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered.length > 0) add(filtered[0]);
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        {selected.size > 0 && <span className="mono dim" style={{ fontSize: 10 }}>{selected.size}</span>}
        {open && (
          <div className="ss-pop">
            {filtered.length === 0 ? (
              <div className="ss-opt empty">{q ? '일치하는 항목 없음' : '모든 항목이 이미 추가됨'}</div>
            ) : (
              filtered.slice(0, 20).map(o => (
                <div key={o} className="ss-opt" onMouseDown={(e) => { e.preventDefault(); add(o); }}>
                  <span>{o}</span>
                  {meta && meta[o] && <span className="meta">{meta[o]}</span>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
      {selected.size > 0 && (
        <div className="ss-chips">
          {[...selected].map(s => (
            <DismissChip key={s} onDismiss={() => onRemove(s)}>{s}</DismissChip>
          ))}
        </div>
      )}
    </div>
  );
};
