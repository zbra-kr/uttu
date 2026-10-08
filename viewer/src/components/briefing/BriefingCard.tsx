'use client';
import Link from 'next/link';

interface Props {
  icon: string;
  title: string;
  comment: string;
  href: string;
  evidenceDate?: string;
}

export default function BriefingCard({ icon, title, comment, href, evidenceDate }: Props) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 14,
        border: '0.5px solid var(--bd)',
        borderRadius: 10,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'background 0.12s',
        background: 'var(--bg)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.background = 'var(--snk)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>{title}</span>
      </div>
      <p style={{
        margin: 0,
        fontSize: 13,
        color: 'var(--f2)',
        lineHeight: 1.6,
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {comment}
      </p>
        {evidenceDate && <span style={{ fontSize: 11, color: 'var(--f3)', lineHeight: 1.5 }}>
          {evidenceDate} 브리핑 · 해당일 감지 기록
        </span>}
    </Link>
  );
}
