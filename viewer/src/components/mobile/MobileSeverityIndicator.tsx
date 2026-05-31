'use client';

export type Severity = 'high' | 'medium' | 'low' | 'positive';

export interface MobileSeverityIndicatorProps {
  severity: Severity;
  height?: string | number;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  high:     'var(--shf)',
  medium:   'var(--smf)',
  low:      'var(--f3)',
  positive: 'var(--slf)',
};

export default function MobileSeverityIndicator({ severity, height = '100%' }: MobileSeverityIndicatorProps) {
  return (
    <div style={{
      width: 4,
      height,
      borderRadius: 2,
      background: SEVERITY_COLOR[severity],
      flexShrink: 0,
    }} />
  );
}
