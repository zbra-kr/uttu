'use client';
import React from 'react';

interface IconProps {
  size?: number;
  stroke?: number | string;
  fill?: string;
  style?: React.CSSProperties;
  className?: string;
}

const Icon = ({ d, size = 16, stroke = 1.25, fill = 'none', style = {}, className }: IconProps & { d: React.ReactNode }) => {
  const isNoStroke = stroke === 'none' || stroke === 0;
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16"
      fill={fill}
      stroke={isNoStroke ? 'none' : 'currentColor'}
      strokeWidth={isNoStroke ? undefined : (stroke as number)}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
      className={className}
    >
      {d}
    </svg>
  );
};

export const UttuMark = ({ size = 1, color = 'currentColor' }: { size?: number; color?: string }) => {
  const u = size * 2;
  const cell = (x: number, y: number, k: string) => (
    <rect key={k} x={x * u} y={y * u} width={u} height={u} fill={color} />
  );
  const ushape = (ox: number, p: string) => [
    ...[0,1,2,3,4,5].flatMap(y => [cell(0, y, `${p}l${y}`), cell(4, y, `${p}r${y}`)]),
    ...[1,2,3].map(x => cell(x, 6, `${p}b${x}`)),
  ].map((c, i) => React.cloneElement(c, { key: `${p}-${i}`, transform: `translate(${ox * u},0)` }));
  const tshape = (ox: number, p: string) => [
    ...[0,1,2,3,4].map(x => cell(x, 0, `${p}t${x}`)),
    ...[1,2,3,4,5,6].map(y => cell(2, y, `${p}s${y}`)),
  ].map((c, i) => React.cloneElement(c, { key: `${p}-${i}`, transform: `translate(${ox * u},0)` }));
  return (
    <svg width={26 * u} height={7 * u} viewBox={`0 0 ${26 * u} ${7 * u}`} style={{ display: 'block' }}>
      {ushape(0, 'u1')}
      {tshape(7, 't1')}
      {tshape(14, 't2')}
      {ushape(21, 'u2')}
    </svg>
  );
};

export const IcHome = (p: IconProps) => <Icon {...p} d={<><path d="M2 7l6-5 6 5"/><path d="M3.5 6.5v7h9v-7"/></>} />;
export const IcCompany = (p: IconProps) => <Icon {...p} d={<><rect x="2.5" y="2.5" width="6" height="11"/><rect x="8.5" y="5.5" width="5" height="8"/><path d="M4 5h3M4 7h3M4 9h3M4 11h3M10 7.5h2M10 9.5h2M10 11.5h2"/></>} />;
export const IcBrand = (p: IconProps) => <Icon {...p} d={<><path d="M8 2L13.5 7.5L8 13L2.5 7.5L8 2z"/><circle cx="8" cy="7.5" r="1.5"/></>} />;
export const IcProduct = (p: IconProps) => <Icon {...p} d={<><path d="M8 2L13.5 5v6L8 14L2.5 11V5L8 2z"/><path d="M2.5 5l5.5 3 5.5-3M8 8v6"/></>} />;
export const IcPromo = (p: IconProps) => <Icon {...p} d={<><circle cx="5" cy="5" r="1.5"/><circle cx="11" cy="11" r="1.5"/><path d="M12.5 3.5l-9 9"/></>} />;
export const IcReview = (p: IconProps) => <Icon {...p} d={<><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5A1.5 1.5 0 0 1 12 10.5H7L4 13.5V10.5A1.5 1.5 0 0 1 2.5 9V4z"/><path d="M5.5 6h5M5.5 8h3"/></>} />;
export const IcMapping = (p: IconProps) => <Icon {...p} d={<><circle cx="3.5" cy="3.5" r="2"/><circle cx="12.5" cy="12.5" r="2"/><path d="M5 5l6 6"/></>} />;
export const IcSettings = (p: IconProps) => <Icon {...p} d={<><circle cx="8" cy="8" r="2"/><path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4"/></>} />;
export const IcSearch = (p: IconProps) => <Icon {...p} d={<><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></>} />;
export const IcBell = (p: IconProps) => <Icon {...p} d={<><path d="M4 7a4 4 0 0 1 8 0v3l1 2H3l1-2z"/><path d="M6.5 12.5a1.5 1.5 0 0 0 3 0"/></>} />;
export const IcSpark = (p: IconProps) => <Icon {...p} d={<path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4L8 2z" fill="currentColor" stroke="none"/>} />;
export const IcArrowR = (p: IconProps) => <Icon {...p} d={<><path d="M3 8h10M9 4l4 4-4 4"/></>} />;
export const IcArrowUR = (p: IconProps) => <Icon {...p} d={<><path d="M5 11l6-6M6 5h5v5"/></>} />;
export const IcArrowD = (p: IconProps) => <Icon {...p} d={<><path d="M8 3v10M4 9l4 4 4-4"/></>} />;
export const IcArrowU = (p: IconProps) => <Icon {...p} d={<><path d="M8 13V3M4 7l4-4 4 4"/></>} />;
export const IcChevD = (p: IconProps) => <Icon {...p} d={<path d="M4 6l4 4 4-4"/>} />;
export const IcChevR = (p: IconProps) => <Icon {...p} d={<path d="M6 4l4 4-4 4"/>} />;
export const IcChevL = (p: IconProps) => <Icon {...p} d={<path d="M10 4l-4 4 4 4"/>} />;
export const IcPlus = (p: IconProps) => <Icon {...p} d={<><path d="M8 3v10M3 8h10"/></>} />;
export const IcMinus = (p: IconProps) => <Icon {...p} d={<path d="M3 8h10"/>} />;
export const IcX = (p: IconProps) => <Icon {...p} d={<><path d="M4 4l8 8M12 4l-8 8"/></>} />;
export const IcCheck = (p: IconProps) => <Icon {...p} d={<path d="M3 8l3.5 3.5L13 5"/>} />;
export const IcStar = (p: IconProps) => <Icon {...p} d={<path d="M8 2l1.8 4 4.2.4-3.2 2.8 1 4.3L8 11.4 4.2 13.5l1-4.3L2 6.4 6.2 6z"/>} />;
export const IcBookmark = (p: IconProps) => <Icon {...p} d={<path d="M4 2.5h8v11l-4-2.5-4 2.5z"/>} />;
export const IcDownload = (p: IconProps) => <Icon {...p} d={<><path d="M8 2v8M4 7l4 4 4-4"/><path d="M3 13h10"/></>} />;
export const IcFilter = (p: IconProps) => <Icon {...p} d={<path d="M2 3h12l-4.5 5v5l-3-1.5v-3.5z"/>} />;
export const IcEdit = (p: IconProps) => <Icon {...p} d={<path d="M3 13l1-3 7-7 2 2-7 7z"/>} />;
export const IcMore = (p: IconProps) => <Icon {...p} fill="currentColor" stroke="none" d={<><circle cx="4" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="12" cy="8" r="1"/></>} />;
export const IcLink = (p: IconProps) => <Icon {...p} d={<><path d="M6.5 9.5l3-3M5.5 7.5L4 9a2 2 0 1 0 3 3l1.5-1.5M10.5 8.5L12 7a2 2 0 1 0-3-3L7.5 5.5"/></>} />;
export const IcMenu = (p: IconProps) => <Icon {...p} d={<><path d="M2 4h12M2 8h12M2 12h12"/></>} />;
export const IcCalendar = (p: IconProps) => <Icon {...p} d={<><rect x="2.5" y="3.5" width="11" height="10"/><path d="M2.5 6.5h11M5 2v3M11 2v3"/></>} />;
export const IcRanking = (p: IconProps) => <Icon {...p} d={<><path d="M2 13h2v-4h-2zM6 13h2v-7h-2zM10 13h2v-10h-2z"/></>} />;
export const IcBrandRanking = (p: IconProps) => <Icon {...p} d={<><rect x="5.5" y="5" width="5" height="8"/><rect x="1.5" y="7.5" width="4" height="5.5"/><rect x="10.5" y="9" width="4" height="4"/><path d="M1 13.5h14"/></>} />;
export const IcFlag = (p: IconProps) => <Icon {...p} d={<><path d="M3 2v12M3 3h9l-2 2.5L12 8H3"/></>} />;
export const IcUser = (p: IconProps) => <Icon {...p} d={<><circle cx="8" cy="5.5" r="2.5"/><path d="M2.5 13.5C2.5 11 5 9 8 9s5.5 2 5.5 4.5"/></>} />;
export const IcSnap = (p: IconProps) => <Icon {...p} d={<><rect x="2" y="4.5" width="12" height="8.5" rx="1"/><circle cx="8" cy="8.75" r="2.5"/><path d="M5.5 4.5l1-1.5h3l1 1.5"/></>} />;
export const IcBook = (p: IconProps) => <Icon {...p} d={<><path d="M3 3h4.5a1.5 1.5 0 0 1 1.5 1.5V13l-1.5-.8a1.5 1.5 0 0 0-1.5 0L3 13V3z"/><path d="M7 3h4.5a1.5 1.5 0 0 1 1.5 1.5V13l-1.5-.8a1.5 1.5 0 0 0-1.5 0L8.5 13"/></>} />;
export const IcUsers = (p: IconProps) => <Icon {...p} d={<><circle cx="6" cy="6" r="2"/><circle cx="11" cy="6.5" r="1.5"/><path d="M2.5 13c0-2 1.6-3.5 3.5-3.5s3.5 1.5 3.5 3.5M10 13c0-1.5 1-2.5 2-2.5s2 1 2 2.5"/></>} />;
export const IcShield   = (p: IconProps) => <Icon {...p} d={<><path d="M8 1.5L13 3v5c0 3.3-2.4 5.7-5 6.5C5.4 13.7 3 11.3 3 8V3z"/><path d="M5.5 8L7 9.5l3.5-3.5"/></>} />;
export const IcExpand   = (p: IconProps) => <Icon {...p} d={<><path d="M9 3h4v4M13 3l-4.5 4.5M7 13H3v-4M3 13l4.5-4.5"/></>} />;
export const IcContract = (p: IconProps) => <Icon {...p} d={<><path d="M13 7H9V3M9 7l4.5-4.5M3 9h4v4M7 9l-4.5 4.5"/></>} />;
export const IcClock    = (p: IconProps) => <Icon {...p} d={<><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 2"/></>} />;
export const IcDot = ({ size = 6, color = 'currentColor', style = {} }: { size?: number; color?: string; style?: React.CSSProperties }) => (
  <span style={{ display: 'inline-block', width: size, height: size, borderRadius: 999, background: color, flexShrink: 0, ...style }} />
);
