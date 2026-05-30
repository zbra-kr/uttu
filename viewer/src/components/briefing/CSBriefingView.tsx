'use client';
import { Briefing } from '@/lib/queries-briefing';
import BriefingHeadline from './BriefingHeadline';
import BriefingCard from './BriefingCard';
import BriefingInsight from './BriefingInsight';

interface Props {
  briefing: Briefing;
}

const CARDS: { key: string; icon: string; title: string; href: string }[] = [
  { key: 'today_reviews',   icon: '💬', title: '오늘의 리뷰',    href: '/reviews' },
  { key: 'low_pattern',     icon: '🔻', title: '저점 패턴',      href: '/reviews' },
  { key: 'high_pattern',    icon: '🔺', title: '고점 패턴',      href: '/reviews' },
  { key: 'problem_product', icon: '🚨', title: '문제 상품',      href: '/product' },
];

export default function CSBriefingView({ briefing }: Props) {
  const comments = briefing.card_comments ?? {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <BriefingHeadline briefing={briefing} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 10,
      }}>
        {CARDS.map(({ key, icon, title, href }) => (
          comments[key] ? (
            <BriefingCard
              key={key}
              icon={icon}
              title={title}
              comment={comments[key]}
              href={href}
            />
          ) : null
        ))}
      </div>

      {briefing.insights && briefing.insights.length > 0 && (
        <BriefingInsight insights={briefing.insights} />
      )}
    </div>
  );
}
