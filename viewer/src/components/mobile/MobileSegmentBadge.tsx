'use client';

export interface MobileSegmentBadgeProps {
  label: string;
}

export default function MobileSegmentBadge({ label }: MobileSegmentBadgeProps) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 500,
      color: 'var(--hs)',
      background: 'var(--hs-soft)',
      padding: '2px 6px',
      borderRadius: 5,
      border: '1px solid var(--bd)',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
