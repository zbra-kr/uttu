'use client';
import { Briefing } from '@/lib/queries-briefing';
import { BriefingKpiData } from '@/lib/queries-kpi';
import BriefingHeadline from './BriefingHeadline';
import BriefingCard from './BriefingCard';
import BriefingInsight from './BriefingInsight';
import BriefingKpiRow from './BriefingKpiRow';

interface Props {
  briefing: Briefing;
  kpiData: BriefingKpiData | null;
}

const CARDS: { key: string; icon: string; title: string; href: string }[] = [
  { key: 'own_ranking',  icon: '📊', title: '자사 랭킹',         href: '/ranking' },
  { key: 'promotion',    icon: '🎁', title: '프로모션',           href: '/promo' },
  { key: 'anomaly',      icon: '⚠️',  title: '이상 탐지',         href: '/anomaly' },
  { key: 'review',       icon: '💬', title: '고객 리뷰',          href: '/reviews' },
  { key: 'competitor',   icon: '🏆', title: '경쟁 브랜드 동향',   href: '/brand-ranking' },
  { key: 'trend',        icon: '📈', title: '트렌드',             href: '/magazine' },
  { key: 'dart',         icon: '📋', title: 'DART 공시',          href: '/company' },
  { key: 'news',         icon: '📰', title: '외부 뉴스',          href: '/magazine' },
];

export default function StaffBriefingView({ briefing, kpiData }: Props) {
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

      {kpiData && (
        <BriefingKpiRow
          ownBrands={kpiData.own_brands}
          anomalies={kpiData.anomalies}
          competitor_top5={kpiData.competitor_top5}
        />
      )}

      {briefing.insights && briefing.insights.length > 0 && (
        <BriefingInsight insights={briefing.insights} briefingDate={briefing.briefing_date} audience="staff" />
      )}
    </div>
  );
}
