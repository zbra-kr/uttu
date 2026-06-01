# UTTU 모바일 점검 보고서 (2026-06-01)

## 총평

- **진행된 Stage**: 11 / 12 / 13 / 14 / 15 / 16 — 전체 완료
- **총 점검 파일 수**: 57개 (신규 31개 Mobile 파일 + 수정 25개 page.tsx + 보고서 1개)
- **야간 세션 데스크탑 코드 변경**: 없음 (Stage 11~16 commits 기준)
- **전체 평가**: **조건부 합격** — 기능 골격은 완성됐으나 공통 컴포넌트 미활용, CSS hex 위반 7건, 스펙 누락 3건 보완 필요

> ⚠️ **커밋 구조 주의**: `2b500e7 모바일버전 업데이트` (11:17 AM)는 정호철 본인 커밋으로 MobileShell.tsx, ShellClient.tsx 수정, AiPanel.tsx 수정, worker 3파일 수정, briefing/mobile/* 컴포넌트가 포함됨. 이 커밋은 야간 AI 작업물이 아니므로 위반 판단에서 제외함. 야간 AI 범위는 `3061462`~`6ee368b` (Stage 11~16).

---

## 1. 데스크탑 코드 변경 위반

**야간 세션(Stage 11~16) 기준: 없음** ✅

야간 세션이 수정한 page.tsx 25개 중:
- **단순 분기형** (4줄 추가) 20개: `import useIsMobile` + `import MobileXxxView` + `const isMobile = useIsMobile()` + `if (isMobile) return <MobileXxxView />` — 기존 코드 변경 0줄
- **Suspense 재구조형** (14줄) 5개: anomaly, brand, company, magazine, product

  > 이유: 해당 5개 page.tsx의 원래 export default가 이미 Suspense 내부에서 `useSearchParams` 등을 호출하는 구조였음. `useIsMobile()`도 내부 hook이므로 동일 Suspense 경계 안에 두려면 wrapper 함수가 필요. **기존 데스크탑 로직(내부 컴포넌트) 자체는 한 줄도 변경 없음.**

```diff
// 예: anomaly/page.tsx 변경 패턴
-export default function AnomalyPageRoot() {
+function AnomalyPageRootInner() {         // ← 새 wrapper
+  const isMobile = useIsMobile();
+  if (isMobile) return <MobileAnomalyView />;
   return (<React.Suspense><AnomalyPage /></React.Suspense>);
 }
+export default function AnomalyPageRoot() {
+  return (<React.Suspense><AnomalyPageRootInner /></React.Suspense>);
+}
```

**야간 세션의 데스크탑 코드 변경 라인 수: 0줄 (확인됨).**

---

## 2. 시안 일치성

시안 파일(`docs/design/UTTU Mobile (standalone).html`)은 JS 번들 형식이어서 개별 화면 픽셀 비교는 불가. 스펙 텍스트에 명시된 항목으로 평가.

**일치 항목** (스펙 대비):
- 컨테이너 padding 12px ✅
- 카드: var(--sur) 배경 + var(--bd) 1px border + radius 10px ✅
- 가로 스크롤 필터 칩 (MobileFilterChips) ✅
- 자사 배지: var(--hs-soft) 배경 + var(--hs) 텍스트 ✅ (스펙 `var(--hs-bg)` 표기는 오기, 실제 토큰은 `--hs-soft`)
- 이상탐지 severity 컬러바 (MobileSeverityIndicator) ✅
- 랭킹 BottomSheet 필터 ✅
- 무한 스크롤 (ranking, reviews) ✅
- 상세 페이지 Recharts ResponsiveContainer ✅ (product, brand, company)
- 스냅 2열 그리드 + 풀스크린 ✅

**불일치 / 누락 항목** (스펙 대비):
1. **로그인 화면 카피 텍스트 누락** (`MobileLoginView.tsx`)
   - 스펙 요구: `"수메르 신화에서 실을 엮어 옷을 만든 여신, UTTU. 흩어진 데이터를 한 자리에 엮어 인사이트로 만듭니다. B.CAVE 전 직원과 AI가 함께 짭니다."`
   - 현재: 없음. 대신 `"B.CAVE 메일계정으로 접속하세요"` 한 줄만 있음

2. **recommend 차트 누락** (`MobileRecommendView.tsx`)
   - 스펙 요구: `오늘 노출 수 KPI (큰 숫자) + 자사 노출 비율 차트 (30일, Recharts ResponsiveContainer)`
   - 현재: KPI 숫자(어제 집계 기반)만 있고 시계열 차트 없음

3. **report Accordion 섹션 4개 누락** (`MobileReportView.tsx`)
   - 스펙 요구 10개: B, C, S, 1, 2, 3, 4, 5, 6 (+ KPI)
   - 현재 구현: B, C, 5, 6 + KPI 요약만 → `S.전략인사이트`, `1.콘텐츠판`, `2.추천판`, `3.세일판`, `4.랭킹분석` 5개 섹션 미구현

**시안에 없는데 추가된 요소**: 없음. 즉흥 추가 없음.

---

## 3. CSS 변수 위반

**hex 하드코딩 7건** (모두 `#fff`, 야간 세션 파일 기준):

| 파일 | 라인 | 값 | 컨텍스트 |
|---|---|---|---|
| `login/MobileLoginView.tsx` | 18 | `#fff` | 로그인 버튼 텍스트 |
| `signup/MobileSignupView.tsx` | 18 | `#fff` | 가입 버튼 텍스트 |
| `forgot-password/MobileForgotPasswordView.tsx` | 18 | `#fff` | 전송 버튼 텍스트 |
| `snap/MobileSnapView.tsx` | 56 | `#fff` | 이미지 오버레이 텍스트 |
| `snap/MobileSnapView.tsx` | 79 | `#fff` | 풀스크린 닫기 버튼 |
| `admin/mapping/MobileAdminMappingView.tsx` | 100 | `#fff` | 활성 탭 텍스트 |
| `admin/anomalies/MobileAdminAnomaliesView.tsx` | 49 | `#fff` | 활성 필터 버튼 텍스트 |

추가로 `snap/MobileSnapView.tsx`에 `rgba(0,0,0,0.5)`, `rgba(0,0,0,0.9)` 2건 — 오버레이 전용이므로 기능상 문제는 없으나 규칙 위반.

수정 방법: `#fff` → `var(--rai)` (tokens.css에 `--rai: #ffffff` 있음)

**Tailwind 기본 색상 클래스**: 없음 ✅

---

## 4. 공통 컴포넌트 재사용

### MobileListCard — 전혀 사용되지 않음 ❌

Stage 11에서 생성됐으나 Stage 12~16 어느 페이지도 import하지 않음. 각 페이지가 인라인 카드 JSX를 직접 구현함. 결과적으로 `MobileListCard`는 **데드 코드**.

| 컴포넌트 | 사용 페이지 수 | 사용 페이지 |
|---|---|---|
| MobileEmptyState | 21개 | 전체 ✅ |
| MobileFilterChips | 15개 | ranking, brand-ranking, anomaly, companies, reviews, promo, magazine, snap, matching, recommend, me, report 등 ✅ |
| MobileBottomSheet | **1개** | ranking (필터 시트)만 |
| MobileSegmentBadge | **1개** | ranking (gf/age 배지)만 |
| MobileSeverityIndicator | **1개** | anomaly만 |
| **MobileListCard** | **0개** | **미사용** ❌ |

**중복 제작**: MobileListCard 대신 각 페이지 인라인 카드 — `padding: '12px 13px'` + `background: var(--sur)` + `border: 1px solid var(--bd)` + `borderRadius: 10` 패턴은 일관되게 반복됨. MobileListCard가 있음에도 재사용 안 한 것은 설계 의도 위반.

---

## 5. 페이지별 품질 (표)

| 페이지 | 시안일치 | 톤매칭 | 정보완결 | 코드품질 | 종합 |
|---|---|---|---|---|---|
| /ranking | 5 | 5 | 5 | 5 | **5.0** |
| /brand-ranking | 4 | 5 | 4 | 5 | **4.5** |
| /companies | 4 | 4 | 4 | 5 | **4.3** |
| /anomaly | 5 | 5 | 5 | 5 | **5.0** |
| /reviews | 5 | 5 | 5 | 5 | **5.0** |
| /promo | 4 | 4 | 4 | 4 | **4.0** |
| /magazine | 4 | 4 | 4 | 5 | **4.3** |
| /snap | 4 | 4 | 4 | 3 | **3.8** |
| /matching | 4 | 4 | 4 | 5 | **4.3** |
| /recommend | 3 | 4 | 2 | 4 | **3.3** |
| /product | 5 | 5 | 4 | 5 | **4.8** |
| /brand | 5 | 5 | 4 | 5 | **4.8** |
| /company | 5 | 5 | 4 | 5 | **4.8** |
| /report | 3 | 4 | 2 | 4 | **3.3** |
| /me | 4 | 4 | 4 | 5 | **4.3** |
| /admin/users | 4 | 4 | 4 | 5 | **4.3** |
| /admin/llm | 3 | 4 | 3 | 4 | **3.5** |
| /admin/jobs | 4 | 4 | 4 | 5 | **4.3** |
| /admin/notifications | 3 | 4 | 3 | 4 | **3.5** |
| /admin/mapping | 3 | 4 | 4 | 2 | **3.3** |
| /admin/anomalies | 4 | 4 | 4 | 3 | **3.8** |
| /login | 3 | 4 | 3 | 4 | **3.5** |
| /signup | 3 | 4 | 3 | 4 | **3.5** |
| /forgot-password | 3 | 4 | 3 | 4 | **3.5** |

**페이지별 한 줄 코멘트**:
- **/ranking**: 가장 완성도 높음. BottomSheet 필터·무한 스크롤·배지 모두 구현
- **/brand-ranking**: 깔끔하나 클릭 시 /brand 이동 파라미터가 `?id=` 여야 하는지 확인 필요
- **/companies**: 검색+정렬 구현됨. DART 배지 없음(데이터 있으면 추가 필요)
- **/anomaly**: severity 컬러바 + 필터 + 타임스탬프 모두 잘 구현됨
- **/reviews**: 닉네임·ID 표시 없음 확인 ✅. 별점 분포 막대 그래프 미구현(리스트만 있음)
- **/promo**: 직접 Supabase 쿼리지만 error 처리 있음. 자사 SKU 카운트 배지 구현 ✅
- **/magazine**: 썸네일 이미지 있음. 자사 노출 수 표시 없음(MagazineRow에 해당 필드 없을 수도)
- **/snap**: 2열 그리드·풀스크린 구현됨. hex '#fff' 위반, rgba 오버레이 위반
- **/matching**: 검색+유사 상품 리스트. 유사도 % 표시가 데이터 있을 때만 작동
- **/recommend**: 모듈 리스트만 있고 30일 추이 차트 없음 — 가장 스펙 미달인 페이지 중 하나
- **/product**: Recharts 차트 2개(랭킹·가격 추이), 리뷰 요약 구현. 이미지 있으면 풀폭 표시
- **/brand**: 브랜드 랭킹 추이 차트·상품 리스트 구현. 리뷰 요약은 reviews 페이지 링크로 처리
- **/company**: 재무 KPI 4개·DART 공시·브랜드 리스트·Recharts 바차트 구현됨
- **/report**: Accordion 구조 잘 됨. 섹션 5개 누락. 차트 전혀 없음
- **/me**: 탭 필터 + 북마크/메모/알림 구독 구현. 현재 탭 상태가 URL에 저장 안 됨(새로고침 초기화)
- **/admin/users**: 기본 CRUD. 역할 변경 메뉴 없음(스펙 요구)
- **/admin/llm**: 46줄로 매우 단순. 실질 기능 부재
- **/admin/jobs**: 기본 리스트. 진행률·실시간 업데이트 없음
- **/admin/notifications**: 기본 큐 표시. 발송 액션 없음
- **/admin/mapping**: DART 매핑·브랜드 연결 구현됨. `const { data }` error 미처리 2건 ❌
- **/admin/anomalies**: 룰 리스트 구현. 임계값 슬라이더 없음(스펙 요구). hex 위반 1건
- **/login**: 로그인 폼 기능적 구현. UTTU 카피 텍스트 누락. hex 위반 1건
- **/signup**: 기능적. hex 위반 1건
- **/forgot-password**: 기능적. hex 위반 1건

---

## 6. 절대 금지사항 위반

| 항목 | 결과 |
|---|---|
| mock 데이터 사용 | **없음** ✅ |
| `const { data } = await query` (error 무시) | **2건** ❌ `admin/mapping/MobileAdminMappingView.tsx` L34, L46 |
| PostgREST 1000행 상한 무시 | **없음** ✅ (직접 쿼리 4개 모두 `.limit()` 명시) |
| 닉네임·사용자ID 표시 | **없음** ✅ |
| 마이그레이션 추가·자동 적용 | **없음** ✅ |
| worker 코드 수정 (야간 세션) | **없음** ✅ |
| 데스크탑 컴포넌트 수정 (야간 세션) | **없음** ✅ |

---

## 7. 일관성 평가

**카드 스타일**: **대체로 일관** ✅
- 기본 패턴 `background: var(--sur)` + `border: 1px solid var(--bd)` + `borderRadius: 10` + `padding: '12px 13px'`으로 대부분 통일
- 일부 이탈: `admin/anomalies` radius 8, `snap` radius 8 (이미지 썸네일)

**폰트 사용**: **일관** ✅
- 숫자·코드·타임스탬프: `var(--mono)`
- 한글 본문: CSS 기본(var(--sans) 상속)
- 시안 지시 `var(--kr)`은 tokens.css에 없어 모두 생략됨 (--sans와 동일 처리 무방)

**간격**: **대체로 일관** ✅
- 컨테이너 padding `0 12px 20px` 일관
- 카드 gap `8~10px` 일관

**자사 배지**: **일관** ✅
- 전체 `fontSize: 9~10`, `color: var(--hs)`, `background: var(--hs-soft)`, `borderRadius: 3~4` — 미세 수치 차이 있으나 시각적 동일

**MobileListCard 불활용**: **불일관** ❌
- 각 페이지 인라인 카드 구조는 사실상 동일하지만 코드가 파일마다 반복됨

---

## 8. 보완 우선순위 제안

> 정호철이 검토 후 결정. 각 항목은 독립적으로 적용 가능.

### P1 — 즉시 수정 필요

**① error 처리 누락 (절대 규칙 위반)**
- 영향: `admin/mapping/MobileAdminMappingView.tsx` L34, L46
- 내용: `const { data } = await sb...` → `const { data, error } = await sb...; if (error) { 처리 }`
- 난이도: 낮음 / 예상 시간: 10분

**② CSS hex 하드코딩 7건**
- 영향: login, signup, forgot-password, snap, admin/mapping, admin/anomalies
- 내용: `color: '#fff'` → `color: 'var(--rai)'` 전체 치환
- 난이도: 낮음 / 예상 시간: 10분

### P2 — 스펙 복원

**③ 로그인 UTTU 카피 텍스트 추가**
- 영향: `/login`
- 내용: 로고 아래에 "수메르 신화에서 실을 엮어..." 카피 추가
- 난이도: 낮음 / 예상 시간: 15분

**④ /recommend 차트 추가**
- 영향: `/recommend`
- 내용: 모듈별 7일 추이 Recharts LineChart 추가
- 난이도: 중간 / 예상 시간: 1시간

**⑤ /report 섹션 5개 추가**
- 영향: `/report`
- 내용: S.전략인사이트 / 1.콘텐츠판 / 2.추천판 / 3.세일판 / 4.랭킹분석 섹션 데이터 확인 후 추가
- 난이도: 중간~높음 (fetchDailyReport 반환 구조 확인 필요) / 예상 시간: 2~3시간

### P3 — 코드 품질 개선 (선택)

**⑥ MobileListCard 실제 활용 또는 정리**
- 영향: 전체 Mobile 페이지
- 내용: 각 페이지 인라인 카드를 MobileListCard로 교체하거나, 사용 안 할 거면 파일 삭제
- 난이도: 높음 (25개 파일 수정) / 예상 시간: 반나절
- 권고: MobileListCard가 leading/trailing/badge 모두 지원하므로 교체 시 코드량 대폭 감소. 단 리팩터링이므로 신중히.

**⑦ /admin/users 역할 변경 메뉴**
- 영향: `/admin/users`
- 내용: 스펙 `⋯ 메뉴 (역할 변경, 삭제)` 미구현 — 모바일 bottom sheet로 구현
- 난이도: 중간 / 예상 시간: 1시간

---

*점검 완료. 정호철의 다음 지시를 기다린다.*
