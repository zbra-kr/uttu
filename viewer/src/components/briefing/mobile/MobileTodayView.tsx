'use client';
import React from 'react';
import { AllBriefings, Briefing } from '@/lib/queries-briefing';
import { BriefingKpiData } from '@/lib/queries-kpi';
import MobileBriefingTabs from './MobileBriefingTabs';
import MobileBriefingHeadline from './MobileBriefingHeadline';
import MobileBriefingCard from './MobileBriefingCard';
import MobileBriefingInsight from './MobileBriefingInsight';
import MobileNewsPickList from './MobileNewsPickList';
import MobileCsReviewSheet, { type CsReviewFilter } from './MobileCsReviewSheet';

type AudienceKey = 'executive' | 'staff' | 'cs';

const EXEC_CARDS = [
  { key: 'competitor',   icon: '🏆', title: '경쟁 브랜드 동향', href: '/brand-ranking' },
  { key: 'news',         icon: '📰', title: '외부 뉴스',        href: '/magazine' },
  { key: 'own_ranking',  icon: '📊', title: '자사 랭킹',        href: '/ranking' },
  { key: 'anomaly',      icon: '⚠️',  title: '이상 탐지',        href: '/anomaly' },
];

const STAFF_CARDS = [
  { key: 'own_ranking',  icon: '📊', title: '자사 랭킹',         href: '/ranking'       },
  { key: 'promotion',    icon: '🎁', title: '프로모션',          href: '/promo'         },
  { key: 'anomaly',      icon: '⚠️',  title: '이상 탐지',         href: '/anomaly'       },
  { key: 'review',       icon: '💬', title: '고객 리뷰',          href: '/reviews'       },
  { key: 'competitor',   icon: '🏆', title: '경쟁 브랜드 동향',  href: '/brand-ranking' },
  { key: 'trend',        icon: '📈', title: '트렌드',            href: '/magazine'      },
  { key: 'dart',         icon: '📋', title: 'DART 공시',         href: '/company'       },
  { key: 'news',         icon: '📰', title: '외부 뉴스',         href: '/magazine'      },
];

const CS_CARDS = [
  { key: 'today_reviews',   icon: '💬', title: '오늘의 리뷰', href: '/reviews' },
  { key: 'low_pattern',     icon: '🔻', title: '저점 패턴',   href: '/reviews' },
  { key: 'high_pattern',    icon: '🔺', title: '고점 패턴',   href: '/reviews' },
  { key: 'problem_product', icon: '🚨', title: '문제 상품',   href: '/product' },
];

const CARDS_BY_AUDIENCE: Record<AudienceKey, typeof EXEC_CARDS> = {
  executive: EXEC_CARDS,
  staff:     STAFF_CARDS,
  cs:        CS_CARDS,
};

/* ── EmptyState ── */
function EmptyState({ date, future }: { date: string; future?: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '60px 16px', gap: 10,
      color: 'var(--f3)',
    }}>
      <span style={{ fontSize: 28 }}>{future ? '🔮' : '📭'}</span>
      <p style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>
        {future
          ? `${date}은(는) 미래 날짜입니다.`
          : `${date} 브리핑이 아직 생성되지 않았습니다.`}
      </p>
      {!future && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--f4)' }}>
          매일 06:00 자동 생성됩니다.
        </p>
      )}
    </div>
  );
}

const CS_REVIEW_FILTERS: Record<string, CsReviewFilter> = {
  today_reviews: 'today',
  low_pattern:   'low',
  high_pattern:  'high',
};

/* ── 단일 audience 뷰 ── */
function BriefingContent({ briefing, audience }: { briefing: Briefing; audience: AudienceKey }) {
  const comments = briefing.card_comments ?? {};
  const cards = CARDS_BY_AUDIENCE[audience];
  const [reviewSheet, setReviewSheet] = React.useState<CsReviewFilter | null>(null);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MobileBriefingHeadline briefing={briefing} />

        {cards
          .filter(c => !!comments[c.key])
          .map(({ key, icon, title, href }) => {
            const csFilter = audience === 'cs' ? CS_REVIEW_FILTERS[key] : undefined;
            return (
              <MobileBriefingCard
                key={key}
                icon={icon}
                title={title}
                comment={comments[key]}
                href={href}
                onClick={csFilter ? () => setReviewSheet(csFilter) : undefined}
              />
            );
          })
        }

        {/* executive/staff: 뉴스픽 표시 (CS는 자체 카드에서 처리) */}
        {audience !== 'cs' && briefing.news_picks && briefing.news_picks.length > 0 && (
          <MobileNewsPickList picks={briefing.news_picks} />
        )}

        {briefing.insights && briefing.insights.length > 0 && (
          <MobileBriefingInsight insights={briefing.insights} />
        )}
      </div>

      {reviewSheet && (
        <MobileCsReviewSheet
          filter={reviewSheet}
          briefingDate={briefing.briefing_date}
          onClose={() => setReviewSheet(null)}
        />
      )}
    </>
  );
}

/* ── 메인 뷰 ── */
export interface MobileTodayViewProps {
  data: AllBriefings | null;
  kpiData: BriefingKpiData | null;
  loading: boolean;
  activeDate: string;
  availableDates: string[];
  isFuture: boolean;
  onDateChange: (date: string) => void;
}

export default function MobileTodayView({
  data,
  loading,
  activeDate,
  availableDates,
  isFuture,
  onDateChange,
}: MobileTodayViewProps) {
  const [activeTab, setActiveTab] = React.useState<AudienceKey>('executive');

  const activeBriefing = data ? data[activeTab] : null;

  return (
    <>
      <MobileBriefingTabs
        active={activeTab}
        executive={data?.executive ?? null}
        staff={data?.staff ?? null}
        cs={data?.cs ?? null}
        onSelect={setActiveTab}
        currentDate={activeDate}
        availableDates={availableDates}
        onDateChange={onDateChange}
      />

      <div style={{
        padding: '12px 12px 16px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {loading ? (
          <div style={{
            display: 'flex', justifyContent: 'center',
            padding: '60px 16px', color: 'var(--f4)', fontSize: 13,
            fontFamily: 'var(--mono)',
          }}>
            불러오는 중...
          </div>
        ) : isFuture ? (
          <EmptyState date={activeDate} future />
        ) : activeBriefing === null ? (
          <EmptyState date={data?.briefing_date ?? activeDate} />
        ) : (
          <BriefingContent briefing={activeBriefing} audience={activeTab} />
        )}
      </div>
    </>
  );
}
