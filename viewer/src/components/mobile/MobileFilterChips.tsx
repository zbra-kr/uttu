'use client';

export interface FilterChipItem {
  value: string;
  label: string;
}

export interface MobileFilterChipsProps {
  items: FilterChipItem[];
  activeValue: string;
  onChange: (value: string) => void;
}

export default function MobileFilterChips({ items, activeValue, onChange }: MobileFilterChipsProps) {
  return (
    <div style={{
      display: 'flex', gap: 6, overflowX: 'auto', padding: '0 0 2px',
      scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' as never,
    }}>
      {items.map(({ value, label }) => {
        const isActive = value === activeValue;
        return (
          <button
            key={value}
            onClick={() => onChange(value)}
            style={{
              flexShrink: 0,
              padding: '6px 12px',
              borderRadius: 16,
              border: `1px solid ${isActive ? 'var(--hs)' : 'var(--bd)'}`,
              background: isActive ? 'var(--hs-soft)' : 'var(--sur)',
              color: isActive ? 'var(--hs)' : 'var(--f2)',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer',
              transition: 'opacity 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
