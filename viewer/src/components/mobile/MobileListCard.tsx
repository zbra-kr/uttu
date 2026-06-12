'use client';
import { useState } from 'react';

export interface MobileListCardProps {
  leading?: React.ReactNode;
  title: string;
  subtitle?: string;
  meta?: string;
  trailing?: React.ReactNode;
  badge?: string;
  onClick?: () => void;
  href?: string;
}

export default function MobileListCard({
  leading, title, subtitle, meta, trailing, badge, onClick,
}: MobileListCardProps) {
  const [pressed, setPressed] = useState(false);

  const inner = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 13px',
      background: 'var(--sur)',
      border: '1px solid var(--bd)',
      borderRadius: 10,
      opacity: pressed ? 0.7 : 1,
      transition: 'opacity 0.1s',
      cursor: onClick ? 'pointer' : 'default',
    }}>
      {leading && (
        <div style={{ flexShrink: 0, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {leading}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 13, fontWeight: 600, color: 'var(--f1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title}
          </span>
          {badge && (
            <span style={{
              fontSize: 10, fontWeight: 600, fontFamily: 'var(--mono)',
              color: 'var(--hs)', background: 'var(--hs-soft)',
              padding: '1px 5px', borderRadius: 5, flexShrink: 0,
            }}>
              {badge}
            </span>
          )}
        </div>
        {subtitle && (
          <span style={{
            fontSize: 12, color: 'var(--f3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {subtitle}
          </span>
        )}
        {meta && (
          <span style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)' }}>
            {meta}
          </span>
        )}
      </div>

      {trailing !== undefined ? trailing : (
        onClick ? (
          <span style={{ color: 'var(--f4)', fontSize: 14, flexShrink: 0 }}>→</span>
        ) : null
      )}
    </div>
  );

  if (!onClick) return inner;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      {inner}
    </div>
  );
}
