'use client';
import React from 'react';
import {
  LineChart, Line as RLine, BarChart, Bar as RBar, LabelList,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

interface SparkProps { w?: number; h?: number; up?: boolean; color?: string; style?: React.CSSProperties; }
export const Spark = ({ w = 60, h = 18, up = true, color, style = {} }: SparkProps) => {
  const c = color || 'var(--f3)';
  const d = up
    ? `M0,${h*0.75} Q${w*0.25},${h*0.9} ${w*0.5},${h*0.45} T${w},${h*0.18}`
    : `M0,${h*0.25} Q${w*0.25},${h*0.1} ${w*0.5},${h*0.55} T${w},${h*0.82}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="spk" style={style}>
      <path d={d} fill="none" stroke={c} strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
};

interface SeriesItem { points: number[]; color?: string; dashed?: boolean; label?: string; }
interface LineProps { h?: number; series: SeriesItem[]; yMin?: number; yMax?: number; style?: React.CSSProperties; fill?: boolean; dots?: boolean; accentIdx?: number; labels?: string[]; reversed?: boolean; }
export const Line = ({ h = 180, series, yMin, yMax, style = {}, dots = true, accentIdx, labels, reversed = false }: LineProps) => {
  const len = Math.max(...series.map(s => s.points.length), 2);
  const allPoints = series.flatMap(s => s.points);
  const domainMin = yMin ?? Math.min(...allPoints);
  const domainMax = yMax ?? Math.max(...allPoints);
  const data = Array.from({ length: len }, (_, i) => {
    const row: Record<string, number | string | null> = { i: labels?.[i] ?? i };
    series.forEach((s, si) => { row[`s${si}`] = s.points[i] ?? null; });
    return row;
  });
  const domain: [number | string, number | string] = [domainMin, domainMax];
  return (
    <div style={{ width: '100%', height: h, ...style }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 4" stroke="var(--bs)" vertical={false} />
          <XAxis dataKey="i" hide={!labels} tick={{ fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' }} axisLine={false} tickLine={false} />
          <YAxis domain={domain} hide reversed={reversed} />
          <Tooltip
            contentStyle={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, fontSize: 11, fontFamily: 'var(--mono)' }}
            labelStyle={{ color: 'var(--f3)' }}
            itemStyle={{ color: 'var(--f1)' }}
          />
          {series.map((s, si) => {
            const accent = accentIdx === si;
            const color = s.color || (accent ? 'var(--hs)' : si === 0 ? 'var(--f1)' : si === 1 ? 'var(--f3)' : 'var(--bd)');
            return (
              <RLine key={si} dataKey={`s${si}`} name={s.label ?? `시리즈 ${si + 1}`}
                stroke={color} strokeWidth={accent ? 1.75 : 1.4}
                strokeDasharray={s.dashed ? '4 4' : undefined}
                dot={dots ? { r: 2, fill: color, strokeWidth: 0 } : false}
                activeDot={{ r: 3.5 }}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

interface BarsProps { h?: number; values: number[]; max?: number; color?: string; style?: React.CSSProperties; accentIdx?: number; }
export const Bars = ({ h = 100, values, max, color, style = {}, accentIdx }: BarsProps) => {
  const vw = 400;
  const m = max || Math.max(...values) * 1.05;
  const bw = (vw - (values.length - 1) * 4) / values.length;
  return (
    <svg viewBox={`0 0 ${vw} ${h}`} width="100%" height={h} preserveAspectRatio="none"
      style={{ display: 'block', ...style }}>
      <line x1="0" y1={h - 0.5} x2={vw} y2={h - 0.5} stroke="var(--bs)" strokeWidth="1" />
      {values.map((v, i) => {
        const bh = (v / m) * h;
        const isAccent = accentIdx === i;
        return (
          <rect key={i}
            x={i * (bw + 4)} y={h - bh} width={bw} height={bh}
            fill={isAccent ? (color || 'var(--hs)') : 'var(--bh)'}
            stroke="var(--bs)" strokeWidth="0.5"
          />
        );
      })}
    </svg>
  );
};

interface HBarProps { value: number; max?: number; accent?: boolean; w?: number; h?: number; }
export const HBar = ({ value, max = 100, accent = false, w = 80, h = 6 }: HBarProps) => (
  <div className="bar-fill" style={{ width: w, height: h }}>
    <div style={{ width: `${(value / max) * 100}%`, background: accent ? 'var(--hs)' : 'var(--f2)' }} />
  </div>
);

interface DonutProps { size?: number; percent?: number; label?: string; sub?: string; }
export const Donut = ({ size = 80, percent = 62, label, sub }: DonutProps) => {
  const r = 14, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: 'block' }}>
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--bs)" strokeWidth="3.2" />
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--f1)" strokeWidth="3.2"
        strokeDasharray={`${c * (percent / 100)} ${c}`}
        transform="rotate(-90 16 16)" strokeLinecap="round" />
      {label && <text x="16" y="16.5" textAnchor="middle" className="donut-num" fill="var(--f1)">{label}</text>}
      {sub && <text x="16" y="22" textAnchor="middle" fontFamily="var(--mono)" fontSize="3.5" fill="var(--f3)">{sub}</text>}
    </svg>
  );
};

interface HeatCellProps { value: number; max?: number; invert?: boolean; label?: string | number; }
export const HeatCell = ({ value, max = 100, invert = false, label }: HeatCellProps) => {
  const norm = invert
    ? Math.max(0, Math.min(1, (max - value) / max))
    : Math.max(0, Math.min(1, value / max));
  const opacity = 0.08 + norm * 0.6;
  return (
    <div className="heat-cell" style={{
      background: `color-mix(in oklab, var(--f1) ${opacity * 100}%, var(--rai))`,
      color: norm > 0.5 ? 'var(--bg)' : 'var(--f1)',
    }}>
      {label != null ? label : value}
    </div>
  );
};

interface LineWithMarkProps { h?: number; points: number[]; markX?: number; markLabel?: string; }
export const LineWithMark = ({ h = 150, points, markX = 50, markLabel }: LineWithMarkProps) => {
  const vw = 400;
  const yMin = Math.min(...points) - 5;
  const yMax = Math.max(...points) + 5;
  const norm = (v: number) => h - ((v - yMin) / (yMax - yMin)) * h;
  const stepX = vw / (points.length - 1);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${i * stepX},${norm(p)}`).join(' ');
  const markI = Math.round((markX / 100) * (points.length - 1));
  return (
    <div style={{ position: 'relative', height: h }}>
      <svg viewBox={`0 0 ${vw} ${h}`} width="100%" height={h} preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}>
        <line x1="0" y1={h - 0.5} x2={vw} y2={h - 0.5} stroke="var(--bs)" strokeWidth="1" />
        {[0.25, 0.5, 0.75].map((g, i) => (
          <line key={i} x1="0" y1={h * g} x2={vw} y2={h * g} stroke="var(--bs)" strokeWidth="0.5" strokeDasharray="3 4" />
        ))}
        <path d={d} fill="none" stroke="var(--f1)" strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={markI * stepX} cy={norm(points[markI])} r="3" fill="var(--shf)"
          stroke="var(--bg)" strokeWidth="1.5" />
      </svg>
      {markLabel && (
        <div style={{
          position: 'absolute', left: `${markX}%`, top: 8,
          transform: 'translateX(-50%)',
          background: 'var(--rai)', border: '0.5px solid var(--shf)',
          color: 'var(--shf)',
          fontFamily: 'var(--mono)', fontSize: 10,
          padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
        }}>{markLabel}</div>
      )}
    </div>
  );
};

interface StarsProps { rating: number; max?: number; size?: number; }
export const Stars = ({ rating, max = 5, size = 12 }: StarsProps) => (
  <span style={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
    {Array.from({ length: max }).map((_, i) => (
      <span key={i} style={{ color: i < Math.round(rating) ? 'var(--hs)' : 'var(--bd)', fontSize: size, lineHeight: 1 }}>★</span>
    ))}
  </span>
);

const tooltipStyle = {
  contentStyle: { background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, fontSize: 11, fontFamily: 'var(--mono)' },
  labelStyle: { color: 'var(--f3)' },
  itemStyle: { color: 'var(--f1)' },
  cursor: { fill: 'var(--snk)' },
};

interface HorizBarsProps { data: { name: string; value: number }[]; color?: string; labelWidth?: number; rowH?: number; style?: React.CSSProperties; }
export const HorizBars = ({ data, color = 'var(--hs)', labelWidth = 60, rowH = 22, style = {} }: HorizBarsProps) => (
  <div style={{ width: '100%', height: data.length * rowH + 8, ...style }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart layout="vertical" data={data} margin={{ top: 0, right: 32, left: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={labelWidth}
          tick={{ fontSize: 10, fill: 'var(--f3)', fontFamily: 'var(--mono)' }}
          axisLine={false} tickLine={false} />
        <Tooltip {...tooltipStyle} />
        <RBar dataKey="value" name="SKU" fill={color} radius={[0, 2, 2, 0]} barSize={rowH - 8}>
          <LabelList dataKey="value" position="right"
            style={{ fontSize: 10, fill: 'var(--f2)', fontFamily: 'var(--mono)' }} />
        </RBar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

interface VertBarsProps { data: { name: string; value: number }[]; h?: number; color?: string; style?: React.CSSProperties; }
export const VertBars = ({ data, h = 80, color = 'var(--hs)', style = {} }: VertBarsProps) => (
  <div style={{ width: '100%', height: h, ...style }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--f4)', fontFamily: 'var(--mono)' }} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipStyle} />
        <RBar dataKey="value" name="상품수" fill={color} opacity={0.85} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </div>
);
