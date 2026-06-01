# UTTU 모바일 — Stage 11~16 야간 진행 메시지

> Claude Code에 한 번에 던지는 메시지. Stage 11~16을 순차 진행한다.
> 정호철이 자는 동안 자동 진행. 실패 시 안전하게 멈추고 보고.

---

## Claude Code에 던질 메시지

```
밤사이에 Stage 11~16까지 순차 진행한다. 각 Stage 끝나면 commit + 보고 파일 추가 + 다음 Stage 자동 진행.

전제 조건:
- Stage 10 /today 모바일 검증 완료 (정호철 확인 끝)
- 모바일 셸(MobileShell.tsx) 정상 동작
- useViewport hook 사용 가능
- viewer/src/styles/tokens.css 변수 시스템 사용

==================================================
공통 원칙 (모든 Stage 적용)
==================================================

[코딩 규칙]
1. 데스크탑 코드 0줄 수정 — 기존 page.tsx에 useIsMobile + Mobile 분기만 추가
   import MobileXxxView from '@/components/.../mobile/MobileXxxView';
   import useIsMobile from '@/hooks/useViewport';
   ...
   const isMobile = useIsMobile();
   if (isMobile) return <MobileXxxView {...props} />;
   // 기존 데스크탑 return 그대로

2. 모바일 컴포넌트는 새 폴더에 신규 작성
   - viewer/src/components/{domain}/mobile/MobileXxxView.tsx 패턴
   - 또는 viewer/src/components/mobile/* (공통)

3. 공통 모바일 컴포넌트는 Stage 11에서 먼저 만들고 다른 Stage에서 재사용
   - MobileBottomSheet · MobileFilterChips · MobileListCard 등

4. 절대 하지 말 것:
   - 데스크탑 컴포넌트 수정 (변경 라인 0줄)
   - CSS hex 하드코딩 (tokens.css 변수만)
   - PostgREST 1000행 상한 무시 (.limit() 명시)
   - const { data } = await query (error 변수 필수)
   - mock 데이터 (없으면 EmptyState)
   - 마이그레이션 추가 또는 자동 적용
   - worker 코드 수정
   - 시안에 없는 디자인 즉흥 추가 (docs/design/UTTU-MOBILE.html 참고)

5. 디자인 가이드:
   - 컨테이너 padding: 12px
   - 카드 간격: 8~12px
   - 헤드라인: 22px·600·var(--f1)
   - 본문: 13px·1.7·var(--f2)
   - 카드: var(--sur) + var(--bd) 1px + radius 10
   - 모노스페이스: var(--mono)
   - 한글: var(--kr) 또는 var(--mono)
   - tap 피드백: opacity 0.7
   - 자사 표시 배지: var(--hs-bg) 배경 + var(--hs) 텍스트

[작업 흐름 — 각 Stage마다 반복]
1. 산출 파일 생성
2. cd viewer && npm run build → 통과 확인
3. git add . && git commit -m "feat(mobile): Stage XX - ..."
4. docs/MOBILE_NIGHT_REPORT.md에 결과 추가
5. 다음 Stage 자동 진행

[중단 조건 — 다음 발생 시 즉시 멈추고 보고]
- npm run build 실패
- 데스크탑 page.tsx 외 파일에 의도치 않은 변경 발견
- 같은 패턴에서 3회 연속 실패
- TypeScript 컴파일 에러 (warning 제외)

[보고 파일 형식 — docs/MOBILE_NIGHT_REPORT.md]
각 Stage 끝날 때마다 다음 형식으로 누적 기록:

## Stage XX — {제목} ({완료 시각})
- 생성 파일: X개
- 수정 파일: Y개 (모두 page.tsx만, 분기 라인 추가)
- 빌드: PASS/FAIL
- commit: {hash}
- 다음 Stage: 진행/중단

==================================================
Stage 11 — 공통 모바일 컴포넌트 (인프라)
==================================================

산출물 — viewer/src/components/mobile/ 폴더 신규
1. MobileBottomSheet.tsx
   - 하단에서 슬라이드 업 (0.3s ease-out)
   - 상단 핸들 (4px×40px gray)
   - 외부 클릭 또는 핸들 드래그로 닫힘
   - 배경: var(--snk), radius 16px 16px 0 0
   - z-index: 100
   - children prop으로 콘텐츠 받음

2. MobileFilterChips.tsx
   - 가로 스크롤 가능한 칩 목록
   - 활성 칩: var(--hs-bg) 배경 + var(--hs) 텍스트
   - 비활성: var(--sur) 배경 + var(--f2) 텍스트
   - 칩 padding: 6px 12px, radius 16px, mono font
   - items: Array<{value, label}>, activeValue, onChange

3. MobileListCard.tsx
   - 공통 리스트 카드 (랭킹/회사/리뷰/프로모 등 다 활용)
   - props: { leading?, title, subtitle?, meta?, trailing?, onClick?, badge? }
   - leading: 아이콘 또는 이미지 (40×40)
   - badge: 자사 표시 등 ("자사", "HOT", "신규")
   - trailing: 변동 화살표 또는 → 화살표
   - tap 시 opacity 0.7

4. MobileSegmentBadge.tsx
   - 카테고리·세그먼트 표시 (gf=A, age=20, cat=001 같은)
   - 작은 모노스페이스 텍스트
   - var(--accent-bg) 배경

5. MobileSeverityIndicator.tsx
   - 좌측 컬러바 (이상탐지·리뷰 별점 표시용)
   - severity: 'high' | 'medium' | 'low' | 'positive'
   - high: var(--danger), medium: var(--warning), low: var(--f3), positive: var(--success)
   - width 4px, height full

6. MobileEmptyState.tsx
   - 데이터 없을 때 공통 표시
   - icon + title + description
   - var(--f3) 색상

검증:
- viewer/src/styles/tokens.css 변수만 사용
- TypeScript strict 통과
- 각 컴포넌트 props interface export

==================================================
Stage 12 — 목록 패턴 1: 랭킹 계열 (4페이지)
==================================================

산출물:
1. viewer/src/app/(app)/ranking/MobileRankingView.tsx
   - 카테고리 가로스크롤 (000~020, MobileFilterChips 활용)
   - 필터 표시: gf=A · age=A (MobileSegmentBadge)
   - "필터 변경" 버튼 → MobileBottomSheet
   - 필터 시트: gf(A/M/F), age(A/10/20/25/30/35/40)
   - 상품 리스트 (MobileListCard)
     - leading: 랭킹 (#1, #2, ...) + 변동 ▲▼
     - title: 상품명 (1줄 ellipsis)
     - subtitle: 브랜드명 (자사면 배지)
     - meta: 가격 + 할인율
     - badge: 자사 표시
     - trailing: → 클릭 시 /product/[id]
   - 무한 스크롤 (50개씩, IntersectionObserver)

2. viewer/src/app/(app)/brand-ranking/MobileBrandRankingView.tsx
   - 브랜드 단위 동일 패턴
   - MobileListCard: 브랜드명 + 회사명 + 평균랭킹 + 변동
   - 클릭 → /brand/[slug]

3. viewer/src/app/(app)/companies/MobileCompaniesView.tsx
   - 검색 입력 (sticky top)
   - 정렬 옵션 (매출/영업이익률/이상탐지 — 칩 또는 드롭다운)
   - 상장만 toggle
   - 회사 카드:
     - title: 회사명
     - subtitle: "브랜드 N개 · 평균 랭킹 N위"
     - meta: 매출 + 영업이익률
     - badge: DART ✓
     - 클릭 → /company/[slug]

4. viewer/src/app/(app)/anomaly/MobileAnomalyView.tsx
   - 심각도 탭 (MobileFilterChips): 🔴 HIGH N · 🟡 MED N · 🟢 호재 N
   - 이상탐지 카드 (MobileListCard + MobileSeverityIndicator):
     - leading: severity 좌측 컬러바
     - title: anomaly_type 한글명
     - subtitle: 상품/브랜드명 + 자사 표시
     - meta: 시각 + 신뢰도 %
     - 클릭 → /product 또는 /brand 상세

기존 page.tsx 4개 수정 — useIsMobile 분기만 추가. 데스크탑 코드 변경 0줄.

==================================================
Stage 13 — 목록 패턴 2: 콘텐츠 계열 (6페이지)
==================================================

산출물:
1. viewer/src/app/(app)/reviews/MobileReviewsView.tsx
   - 브랜드 탭 (전체/커버낫/리/와키윌리)
   - 별점 분포 막대 그래프 (이번 주, var(--hs))
   - 필터 칩: 전체 / 1~2점 (문제) / 4~5점 (강점)
   - 리뷰 카드:
     - leading: 별점 표시 (★★ 등)
     - title: 상품명
     - subtitle: 리뷰 본문 (3줄 clamp) — 닉네임·ID 절대 금지
     - meta: N일 전
   - 무한 스크롤

2. viewer/src/app/(app)/promo/MobilePromoView.tsx
   - 필터 칩: 전체 / 타임딜 / 세일탭 / 신상
   - 프로모션 카드:
     - leading: 🔥 또는 % 아이콘
     - title: 프로모션 제목
     - subtitle: 참여 회사·브랜드
     - meta: 시작/종료 시각
     - badge: "자사 SKU N개 영향"

3. viewer/src/app/(app)/magazine/MobileMagazineView.tsx
   - 필터 칩: 전체 / 스타일 / 트렌드 / 신상
   - 매거진 카드 (이미지 포함):
     - 이미지 (16:9 또는 4:3)
     - 제목 (2줄 clamp)
     - meta: 노출 N건 · 자사 노출 N건
     - 게재일

4. viewer/src/app/(app)/snap/MobileSnapView.tsx
   - 필터 칩
   - 2열 그리드 (이미지 + 좋아요)
   - 카드 클릭 시 풀스크린 이미지

5. viewer/src/app/(app)/matching/MobileMatchingView.tsx
   - 검색 입력 (자사 상품)
   - 선택된 상품 카드
   - 유사 경쟁 상품 리스트 (MobileListCard)
     - title: 상품명
     - subtitle: 브랜드
     - meta: 유사도 % + 가격 + 랭킹

6. viewer/src/app/(app)/recommend/MobileRecommendView.tsx
   - 오늘 노출 수 KPI (큰 숫자)
   - 자사 노출 비율 차트 (30일, Recharts ResponsiveContainer)
   - 카테고리별 노출 리스트

기존 page.tsx 6개 수정 — useIsMobile 분기.

==================================================
Stage 14 — 상세 페이지 (3페이지)
==================================================

산출물:
1. viewer/src/app/(app)/product/MobileProductDetailView.tsx
   - 이미지 캐러셀 (가로 스와이프 또는 단순 가로 스크롤)
   - 브랜드명 + 자사 배지
   - 상품명 (2줄)
   - 가격 + 할인
   - 액션 버튼 행: [⭐ 북마크] [📝 메모]
   - ## 랭킹 추이 (30일, Recharts)
   - ## 가격 추이 (Recharts)
   - ## 프로모션 이력 (리스트)
   - ## 리뷰 (별점 분포 + "전체 보기" 링크)
   - ## 색상 (배지 리스트)
   - ## 매거진 노출 (작은 카드 리스트)
   - ## 스냅 노출 (썸네일 그리드)

2. viewer/src/app/(app)/brand/MobileBrandDetailView.tsx
   - 브랜드 로고 + 자사 배지
   - 회사명
   - 상품 수 + 평균 랭킹
   - 액션 버튼: [📊 매출] [💬 리뷰] [⭐ 북마크]
   - ## 브랜드 랭킹 추이 (차트)
   - ## 카테고리별 분포 (가로 막대)
   - ## 인기 상품 TOP 10 (리스트)
   - ## 최근 프로모션
   - ## 리뷰 요약 (자사 전용)

3. viewer/src/app/(app)/company/MobileCompanyDetailView.tsx
   - 회사명 + 종목코드 + 상장 여부
   - DART 매핑 표시
   - 재무 KPI 4개 (매출·영업이익·이익률·부채비율)
   - ## 매출 추이 (분기별 차트)
   - ## 보유 브랜드 (리스트)
   - ## 최근 공시 (리스트)
   - ## 이상탐지 이력

기존 page.tsx 3개 수정 — useIsMobile 분기.

차트 주의:
- Recharts ResponsiveContainer 필수 (고정 width 금지)
- 모바일 차트 높이: 180~240px
- font-size 10px (모바일에서 작게)

==================================================
Stage 15 — 리포트 + 마이페이지 (2페이지)
==================================================

산출물:
1. viewer/src/app/(app)/report/MobileReportView.tsx
   - 날짜 선택 (간단 버튼 또는 input)
   - Accordion 형식 — 한 번에 1개만 펼침
   - 섹션 10개 (기존 데스크탑 /report 구조 따라):
     - B. 우리 브랜드 현황
     - C. 경쟁사 벤치마크
     - S. 전략 인사이트
     - 1. 콘텐츠판
     - 2. 추천판
     - 3. 세일판
     - 4. 랭킹 분석
     - 5. 브랜드 랭킹 TOP
     - 6. 성별×연령 TOP 3 분석
   - 첫 진입 시 "B. 우리 브랜드 현황"만 펼침
   - 펼친 섹션 안에 차트는 ResponsiveContainer

2. viewer/src/app/(app)/me/MobileMeView.tsx
   - 사용자 정보 (이름·이메일·역할·팀)
   - 탭 (MobileFilterChips): 북마크 / 메모 / 받은 멘션 / 저장 필터 / 알림 구독
   - 각 탭별 리스트 (MobileListCard)
   - 알림 구독 탭: 체크박스 리스트 (anomaly_high, anomaly_medium, daily_summary, review_low 등)
   - [로그아웃] 버튼 (하단)

기존 page.tsx 2개 수정.

==================================================
Stage 16 — 관리자 + 인증 (10페이지)
==================================================

산출물 — 관리자 (admin only 페이지들):

1. viewer/src/app/(app)/admin/users/MobileAdminUsersView.tsx
   - 사용자 카드 리스트 (MobileListCard)
   - title: 이름
   - subtitle: 이메일 · 팀
   - badge: 역할 (admin/viewer)
   - trailing: ⋯ 메뉴 (역할 변경, 삭제)

2. viewer/src/app/(app)/admin/llm/MobileAdminLLMView.tsx
   - LLM 모델 카드
   - 활성/비활성 토글

3. viewer/src/app/(app)/admin/jobs/MobileAdminJobsView.tsx
   - 수집 작업 카드 (realtime)
   - title: script 이름
   - subtitle: status + 진행률
   - meta: 시작 시각 + 소요 시간
   - badge 색상으로 status 구분

4. viewer/src/app/(app)/admin/notifications/MobileAdminNotificationsView.tsx
   - 알림 큐 카드

5. viewer/src/app/(app)/admin/mapping/MobileAdminMappingView.tsx
   - DART 매칭 카드
   - 미매칭 카드 + 수동 매핑 입력

6. viewer/src/app/(app)/admin/anomalies/MobileAdminAnomaliesView.tsx
   - 탐지 룰 카드
   - 임계값 슬라이더 (모바일 친화)

산출물 — 인증:

7. viewer/src/app/login/MobileLoginView.tsx (또는 page.tsx 분기)
   - 화면 중앙 정렬
   - uttu. 로고 크게
   - 시안의 카피 그대로:
     "수메르 신화에서 실을 엮어 옷을 만든 여신, UTTU.
      흩어진 데이터를 한 자리에 엮어 인사이트로 만듭니다.
      B.CAVE 전 직원과 AI가 함께 짭니다."
   - 이메일 + 비밀번호 입력
   - 로그인 버튼 (var(--hs))
   - "비밀번호 찾기" / "회원가입" 링크

8. viewer/src/app/signup/MobileSignupView.tsx
   - 동일 스타일
   - @bcave.co.kr 도메인 제한 안내

9. viewer/src/app/forgot-password/MobileForgotPasswordView.tsx
   - 이메일 입력 → 재설정 링크 발송

기존 page.tsx 9개 수정 — useIsMobile 분기.

==================================================
최종 보고 (Stage 16 끝나면)
==================================================

docs/MOBILE_NIGHT_REPORT.md 최종 마무리:

## 최종 요약
- 진행한 Stage: 11/12/13/14/15/16 중 어디까지
- 생성된 파일 총 N개
- 수정된 page.tsx 총 M개
- 데스크탑 코드 변경 라인 수: 0 (확인)
- 총 commit 수: N개
- 마지막 commit hash: ...

## 다음 단계
- 정호철이 일어나서 검증할 사항:
  - 모바일 브라우저로 각 페이지 확인
  - 데스크탑 페이지 영향 0 확인
  - 디자인 톤 일관성 확인
- 발견될 가능성 높은 이슈:
  - 차트 모바일 사이즈 미세 조정
  - 텍스트 truncation 경계
  - 상세 페이지 이미지 캐러셀 동작

==================================================
시작
==================================================

지금 Stage 11부터 진행한다. 각 Stage 끝나면 commit + 보고 파일 추가 + 다음 Stage 자동.

빌드 실패 또는 데스크탑 코드 의도치 않은 변경 발견 시 즉시 멈추고 보고.

자, 시작.
```

---

## 정호철이 잠들기 전 할 일

1. **레포에 마지막 commit 확인** — Stage 10 결과물 commit 됐는지
2. **Claude Code에 위 메시지 통째로 던지기**
3. **docs/MOBILE_NIGHT_REPORT.md 모니터링** — Cursor 또는 Claude Code 창 열어두고 자기
4. **Vercel auto-deploy 켜져있는지 확인** — 각 commit 시 자동 배포

---

## 아침에 일어나서 할 일

```bash
# 1. 진행 보고 확인
cat ~/projects/uttu/docs/MOBILE_NIGHT_REPORT.md

# 2. 어디까지 됐는지 commit 로그 확인
cd ~/projects/uttu
git log --oneline --since="last night" | head -30

# 3. Vercel 배포 상태 확인
# (Vercel 대시보드 또는 deploy 알림 채널)

# 4. 모바일 폰으로 각 페이지 검증
# https://uttu.bcave.co.kr 또는 vercel preview URL
```

자고 일어났을 때 보통 1~3 Stage 정도 끝나있을 거. 다 못 끝났으면 다음 명령으로 이어 진행 시키면 됨:

```
docs/MOBILE_NIGHT_REPORT.md 확인하고 마지막에 멈춘 Stage 다음부터 계속 진행해라.
원칙·금지사항·작업 흐름은 어제 던진 메시지 그대로.
```

푹 자.
