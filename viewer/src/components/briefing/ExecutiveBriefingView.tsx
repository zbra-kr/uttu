'use client';
import { Briefing } from '@/lib/queries-briefing';
import { BriefingKpiData } from '@/lib/queries-kpi';
import BriefingHeadline from './BriefingHeadline';
import BriefingCard from './BriefingCard';
import BriefingInsight from './BriefingInsight';
import BriefingKpiRow from './BriefingKpiRow';
import NewsPickList from './NewsPickList';

interface Props {
  briefing: Briefing;
  kpiData: BriefingKpiData | null;
}

const CARDS: { key: string; icon: string; title: string; href: string }[] = [
  { key: 'competitor',   icon: '🏆', title: '경쟁 브랜드 동향',  href: '/brand-ranking' },
  { key: 'news',         icon: '📰', title: '외부 뉴스',         href: '/magazine' },
  { key: 'own_ranking',  icon: '📊', title: '자사 랭킹',         href: '/ranking' },
  { key: 'anomaly',      icon: '⚠️',  title: '이상 탐지',         href: '/anomaly' },
];

export default function ExecutiveBriefingView({ briefing, kpiData }: Props) {
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

      {briefing.news_picks && briefing.news_picks.length > 0 && (
        <NewsPickList picks={briefing.news_picks} />
      )}

      {briefing.insights && briefing.insights.length > 0 && (
        <BriefingInsight insights={briefing.insights} briefingDate={briefing.briefing_date} audience="executive" />
      )}
    </div>
  );
}
