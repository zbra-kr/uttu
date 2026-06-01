'use client';
import Link from 'next/link';
import React from 'react';

interface Props {
  icon: string;
  title: string;
  comment: string;
  href: string;
}

export default function MobileBriefingCard({ icon, title, comment, href }: Props) {
  const [pressed, setPressed] = React.useState(false);

  return (
    <Link
      href={href}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 13px',
        border: '1px solid var(--bd)',
        borderRadius: 10,
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--sur)',
        opacity: pressed ? 0.7 : 1,
        transition: 'opacity 0.1s',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>{title}</span>
        <p style={{
          margin: 0,
          fontSize: 12.5,
          color: 'var(--f2)',
          lineHeight: 1.65,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {comment}
        </p>
      </div>
      <span style={{
        fontSize: 13, color: 'var(--f4)', flexShrink: 0, marginTop: 1,
        fontFamily: 'var(--mono)',
      }}>→</span>
    </Link>
  );
}
