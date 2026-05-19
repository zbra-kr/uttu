# Skill 07 — Viewer (Next.js 15)

> Viewer 관련 모든 작업 전 이 파일을 읽어라.

---

## 핵심 원칙

```
1. 쿼리는 lib/queries*.ts 에서만 — 페이지 직접 호출 금지
2. 링크는 lib/routes.ts ROUTES 상수로만 — 하드코딩 금지
3. 색상은 globals.css CSS 변수로만 — hex 금지
4. error 반드시 처리 — 빈 화면 버그 방지
5. 데이터 없으면 EmptyState — mock 데이터 금지
6. NEXT_PUBLIC_USE_MOCK=false — Vercel 환경변수 필수
```

---

## 폴더 구조

```
viewer/
├── app/
│   ├── globals.css           ← CSS 변수 정의
│   ├── layout.tsx
│   └── (app)/
│       ├── layout.tsx        ← 인증·네비게이션
│       ├── page.tsx          ← 홈
│       ├── market/           ← 시장 분석 (상품기획용)
│       │   ├── page.tsx      ← 시장 허브
│       │   ├── segment/      ← 성별×나이대 세그먼트
│       │   ├── companies/    ← 98사 목록 (재무용)
│       │   └── [slug]/       ← 회사 상세
│       ├── own/              ← 자사 분석
│       │   ├── sales/        ← ERP 매출
│       │   └── reviews/      ← CS 리뷰 분석
│       ├── signal/           ← 이상탐지
│       └── ops/              ← 운영 도구
├── lib/
│   ├── routes.ts             ← 크로스링크 상수 (필수)
│   ├── queries-market.ts     ← 시장·브랜드·랭킹 쿼리
│   ├── queries-own.ts        ← 자사 ERP·리뷰 쿼리
│   ├── queries-cs.ts         ← CS 리뷰 분석 쿼리
│   └── queries-dart.ts       ← DART 재무·공시 쿼리
└── components/
    └── uttu/
        ├── app-bar.tsx       ← 네비게이션
        ├── empty-state.tsx
        ├── error-state.tsx
        ├── skeleton-card.tsx
        └── breadcrumb.tsx
```

---

## routes.ts 패턴 (크로스링크 상수)

```typescript
// lib/routes.ts
export const ROUTES = {
  home: '/',
  market: {
    hub: '/market',
    segment: '/market/segment',
    companies: '/market/companies',
    company: (slug: string) => `/market/${slug}`,
  },
  own: {
    hub: '/own',
    sales: '/own/sales',
    reviews: '/own/reviews',
  },
  signal: {
    list: '/signal',
    detail: (id: string) => `/signal/${id}`,
  },
  ops: '/ops',
} as const;

// ✅ 사용 예
<Link href={ROUTES.market.company(company.id)}>회사 상세</Link>

// ❌ 금지
<Link href={`/market/${company.id}`}>회사 상세</Link>
```

---

## CSS 변수 패턴

```css
/* app/globals.css */
:root {
  --color-background-primary:   #ffffff;
  --color-background-secondary: #f9fafb;
  --color-text-primary:         #111827;
  --color-text-secondary:       #6b7280;
  --color-border-primary:       #e5e7eb;
  --color-accent:               #2563eb;
  /* ... */
}
```

```typescript
// ✅ 올바름
className="text-[var(--color-text-primary)]"
style={{ color: 'var(--color-text-secondary)' }}

// ❌ 금지
className="text-gray-900"
style={{ color: '#111827' }}
```

---

## 쿼리 함수 패턴

```typescript
// lib/queries-market.ts

import { createClient } from '@/lib/supabase/server';

export async function getRankingBySegment(
  categoryCode: string,
  genderFilter: string,
  ageFilter: string,
  date?: string,
  limit = 50,
) {
  const supabase = createClient();
  const targetDate = date ?? new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Seoul'
  });

  const { data, error } = await supabase
    .from('ranking_snapshots')
    .select(`
      rank_position,
      list_price,
      discount_rate,
      products (
        id, name, musinsa_no, category_code,
        brands ( id, name, slug, is_own )
      )
    `)
    .eq('category_code', categoryCode)
    .eq('gender_filter', genderFilter)
    .eq('age_filter', ageFilter)
    .eq('snapshot_date', targetDate)
    .order('rank_position', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[getRankingBySegment] failed', error);
    throw error;
  }

  return data ?? [];
}
```

---

## 공통 컴포넌트 패턴

```typescript
// components/uttu/empty-state.tsx
interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; href: string };
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16
                    text-[var(--color-text-secondary)]">
      <p className="text-lg font-medium">{title}</p>
      {description && <p className="mt-2 text-sm">{description}</p>}
      {action && (
        <a href={action.href}
           className="mt-4 text-sm text-[var(--color-accent)] hover:underline">
          {action.label}
        </a>
      )}
    </div>
  );
}
```

---

## 반응형 패턴 (모바일 퍼스트)

```typescript
// KPI strip
<div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">

// 2열 레이아웃
<div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">

// 긴 테이블
<div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
  <table className="min-w-[640px] ...">

// 차트 높이
<div className="h-48 md:h-72">
  <ResponsiveContainer width="100%" height="100%">
```

---

## Vercel 배포 필수 환경변수

```
NEXT_PUBLIC_SUPABASE_URL        → Supabase 프로젝트 URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   → anon 키
SUPABASE_SERVICE_ROLE_KEY       → service_role (server-side only)
NEXT_PUBLIC_SITE_URL            → https://uttu.vercel.app (localhost 아님!)
NEXT_PUBLIC_USE_MOCK            → false (이게 없으면 mock 모드!)
```

---

## 3개 부서 화면 구조

```
상품기획:
  /market/segment
    성별(A/M/F) × 나이대(7개) × 카테고리(9개) 선택
    → 선택한 세그먼트의 TOP 상품 목록
    → 각 상품: 랭킹·가격·프로모션 여부·자사 유사 상품 연결

재무:
  /market/companies
    98사 목록 + 재무 KPI (매출·영업이익·부채비율)
  /market/companies/[slug]
    회사 상세 → 소속 브랜드 → 랭킹 → 이상탐지 내역

CS:
  /own/reviews
    자사 브랜드 선택 → 상품별 리뷰 현황
    별점 분포 차트
    저점 리뷰 문제점 (LLM 분석)
    고점 리뷰 강점 (LLM 분석)
    기간별 트렌드
```
