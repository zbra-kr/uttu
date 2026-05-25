-- 이상탐지 룰 테이블 — admin이 임계값 조정 + on/off
create table if not exists public.detector_rules (
  id           uuid        primary key default gen_random_uuid(),
  detector_key text        unique not null,
  label        text        not null,
  module       text        not null check (module in ('product_planning','brand_planning','cs','custom')),
  severity     text        not null default 'medium' check (severity in ('high','medium','low')),
  enabled      boolean     not null default true,
  params       jsonb       not null default '{}',
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid        references auth.users(id)
);

alter table public.detector_rules enable row level security;

create policy "rules select authenticated"
  on public.detector_rules for select to authenticated using (true);

create policy "rules write admin"
  on public.detector_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── 기본 22개 탐지 룰 초기 데이터 ─────────────────────────────────────────────

insert into public.detector_rules (detector_key, label, module, severity, enabled, params, description) values
-- 상품 랭킹
('rank_spike',           '경쟁 상품 순위 급등',            'product_planning', 'medium', true,
 '{"delta": 20}',
 '전일 대비 delta위 이상 상승 + TOP50 이내 경쟁 상품'),
('rank_drop_own',        '자사 상품 순위 하락',             'product_planning', 'high',   true,
 '{"delta": 10}',
 '전일 대비 delta위 이상 하락. 하락 폭 ≥30위면 high, 그 미만은 medium'),
('new_entrant_top10',    '경쟁 상품 TOP10 신규 진입',       'product_planning', 'medium', true,
 '{"top": 10, "prev_out": 20}',
 '오늘 TOP{top} 이내, 어제 TOP{prev_out} 밖인 경쟁 상품'),
('sold_out',             'TOP50 내 품절 전환',              'product_planning', 'high',   true,
 '{"min_rank": 50}',
 'TOP{min_rank} 이내에서 오늘 품절 전환. 자사는 high, 경쟁은 low'),
('price_drop',           '전일 대비 가격 인하',             'product_planning', 'high',   true,
 '{"rate": 0.10}',
 '전일 대비 rate 이상 가격 인하. 자사 또는 인하율 ≥20%는 high'),
('price_rise',           '전일 대비 가격 인상',             'product_planning', 'medium', true,
 '{"rate": 0.10}',
 '전일 대비 rate 이상 가격 인상. 자사는 medium, 경쟁은 low'),
('rank_exit_own',        '자사 상품 TOP100 이탈',           'product_planning', 'high',   true,
 '{"top": 100}',
 '어제 TOP{top} 이내였지만 오늘 랭킹에서 완전 이탈'),
('rank_return_own',      '자사 상품 TOP50 재진입',          'product_planning', 'low',    true,
 '{"top": 50}',
 '어제 TOP{top} 밖이었다가 오늘 재진입 (긍정 신호)'),
('rank_multi_drop_own',  '자사 상품 동시 다중 하락',         'product_planning', 'high',   true,
 '{"min_count": 3}',
 '같은 날 rank_drop_own 해당 상품이 min_count개 이상 동시 발생'),
-- 프로모션
('promo_heavy_discount', '고할인율 프로모션 노출',           'product_planning', 'medium', true,
 '{"rate": 50.0}',
 '할인율 rate% 이상인 프로모션 상품 노출'),
('promo_item_count_drop','프로모션 상품 수 급감',            'product_planning', 'medium', true,
 '{"drop_rate": 0.30}',
 '전일 대비 drop_rate 이상 프로모션 상품 수 감소'),
('promo_own_exit',       '자사 상품 프로모션 이탈',          'product_planning', 'medium', true,
 '{}',
 '어제 프로모션에 있던 자사 상품이 오늘 목록에서 사라짐'),
-- 브랜드 랭킹
('brand_rank_drop_own',          '자사 브랜드 순위 하락',         'brand_planning', 'high',   true,
 '{"delta": 5}',
 '전일 대비 delta위 이상 하락. 하락 폭 ≥15위는 high'),
('brand_rank_spike_competitor',  '경쟁 브랜드 순위 급등',         'brand_planning', 'medium', true,
 '{"delta": 10, "top": 30}',
 '전일 대비 delta위 이상 상승 + TOP{top} 이내 경쟁 브랜드'),
('brand_new_entrant_top10',      '경쟁 브랜드 TOP10 신규 진입',   'brand_planning', 'medium', true,
 '{"top": 10, "prev_out": 20}',
 '오늘 TOP{top} 이내, 어제 TOP{prev_out} 밖인 경쟁 브랜드'),
('brand_exit_top50_own',         '자사 브랜드 TOP50 이탈',        'brand_planning', 'high',   true,
 '{"top": 50}',
 '어제 TOP{top} 이내였던 자사 브랜드가 오늘 이탈'),
('brand_rank_gender_diverge',    '자사 브랜드 성별 순위 편차',     'brand_planning', 'low',    true,
 '{"diverge": 20}',
 '남성/여성 순위 차이 diverge위 이상, 두 순위 모두 TOP50 이내'),
-- 리뷰
('review_rating_drop',    '자사 상품 별점 급락',          'cs', 'high',   true,
 '{"threshold": 0.3}',
 '최근 7일 평균 < 30일 전체 평균 - threshold점'),
('review_negative_surge', '부정 리뷰 비율 급증',          'cs', 'high',   true,
 '{"rate": 0.30}',
 '최근 7일 1~2점 리뷰 비율 ≥ rate'),
('review_count_surge',    '일일 리뷰 수 급증',            'cs', 'high',   true,
 '{"multiplier": 3.0}',
 '오늘 리뷰 수 > 30일 일평균 × multiplier. 5배↑ high, 3~5배 medium'),
('review_no_activity',    '자사 상품 리뷰 중단',          'cs', 'medium', true,
 '{"min_daily_avg": 1.0}',
 '30일 일평균 ≥ min_daily_avg이었는데 최근 7일 리뷰 0건'),
('review_helpful_surge',  '부정 리뷰 helpful_count 급증', 'cs', 'high',   true,
 '{"helpful_min": 10}',
 '별점 ≤2점 리뷰의 helpful_count ≥ helpful_min')
on conflict (detector_key) do nothing;
