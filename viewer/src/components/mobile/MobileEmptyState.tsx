'use client';

export interface MobileEmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
}

export default function MobileEmptyState({ icon = '📭', title, description }: MobileEmptyStateProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '48px 16px', gap: 8,
      color: 'var(--f3)',
    }}>
      <span style={{ fontSize: 28 }}>{icon}</span>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, textAlign: 'center', color: 'var(--f3)' }}>
        {title}
      </p>
      {description && (
        <p style={{ margin: 0, fontSize: 12, textAlign: 'center', color: 'var(--f4)', lineHeight: 1.5 }}>
          {description}
        </p>
      )}
    </div>
  );
}
