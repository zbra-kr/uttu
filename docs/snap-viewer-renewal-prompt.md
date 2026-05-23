# 스냅 뷰어 페이지 리뉴얼 — 프론트엔드 AI 작업 지시서

> 이 파일을 프론트엔드 AI 에게 그대로 전달한다.

---

## 작업 목표

`viewer/src/app/(app)/snap/page.tsx` 를 **완전히 재작성**한다.
`viewer/src/lib/queries-snap.ts` 는 **수정하지 않는다** — 쿼리 함수는 모두 완성된 상태다.

---

## 반드시 읽어야 할 파일

작업 전 아래 파일을 모두 읽어라:

1. `viewer/src/lib/queries-snap.ts` — 사용 가능한 쿼리 함수·타입 전체
2. `viewer/src/app/globals.css` — CSS 변수 (hex 하드코딩 금지)
3. `viewer/src/components/ui/filters.tsx` — FilterBlock, PillGroup, DismissChip 컴포넌트
4. `viewer/src/components/ui/icons.tsx` — IcSnap, IcX, IcChevL, IcChevR 등

---

## 현재 DB 테이블 구조 (스키마)

### `snaps` — 스냅 원본
| 컬럼 | 설명 |
|---|---|
| snap_id TEXT PK | 스냅 고유 ID |
| content_type | USER_SNAP / BRAND_SNAP / CODISHOP_SNAP |
| thumbnail_url | 썸네일 이미지 URL |
| content_text | 본문 |
| like_count / view_count / scrap_count / goods_click_count / comment_count / click_count | 지표 6종 |
| model_gender | WOMEN / MEN / null |
| model_height / model_weight / model_skin_tone | 모델 신체 정보 |
| hashtags TEXT[] | 해시태그 배열 |
| style_label_ids INT[] | 스타일 라벨 ID 배열 (snap_label_masters 참조) |
| published_at | 게시일 |

### `snap_rankings` — 스냅 일간 랭킹 스냅샷
| 컬럼 | 설명 |
|---|---|
| snapshot_date DATE | 수집 날짜 |
| snap_id TEXT FK→snaps | |
| style_filter TEXT | **NEW** — ALL / CASUAL / STREET / MINIMAL / GIRLISH / ROMANTIC / CHIC |
| gender_filter TEXT | ALL / MEN / WOMEN |
| rank_position SMALLINT | 순위 |
| prev_rank_position SMALLINT | 전날 순위 (null = NEW) |
| highlight TEXT | NEW / MOST_LIKED 등 |
| ranking_period TEXT | DAILY |

하루 수집량: 7 스타일 × 50개 = **최대 350건**

### `snap_label_masters` — 스타일 라벨 마스터
| category_name | 예시 라벨 |
|---|---|
| 계절 | 봄, 여름, 가을, 겨울 |
| 스타일 | 캐주얼, 스트릿, 빈티지, 포멀 … |
| TPO | 데일리, 데이트, 출근, 여행 … |

### `snap_profiles` — 멤버·브랜드 프로필
| 컬럼 | 설명 |
|---|---|
| id TEXT PK | 프로필 ID |
| profile_type | USER / BRAND |
| nickname / bio | 이름·소개글 |
| profile_image_url | 프로필 이미지 |
| follower_count | 팔로워 수 |
| snap_count | 게시물 수 (0 = 미수집) |
| height / weight | USER 전용 (null 가능) |
| badge_title | USER 뱃지 라벨 |
| brand_code | BRAND 전용 슬러그 (e.g. "dolzabi") |

### `snap_profile_rankings` — 프로필 일간 랭킹
snapshot_date, profile_id FK→snap_profiles, profile_type, rank_position, prev_rank_position, highlight

### `snap_profile_snaps` — 프로필 수집 시점 최근 스냅 (최대 10개/프로필/일)
snapshot_date, profile_id FK→snap_profiles, snap_id FK→snaps, display_order

### `snap_products` — 스냅-상품 연결
snap_id FK→snaps, product_id FK→products, musinsa_no, option_name

---

## queries-snap.ts 에서 사용 가능한 함수 (수정 금지)

```typescript
// 날짜
getLatestSnapDate(): Promise<string>

// 스냅 랭킹 (style='ALL'이면 전체, 아니면 해당 스타일만)
getUserSnapRankings(date, gender='ALL', labelIds=[], style='ALL'): Promise<SnapRankRow[]>

// BRAND / CODISHOP 스냅 리스트
getBrandSnaps(page, sort, labelIds=[]): Promise<{rows, total}>
getCodishopSnaps(page, sort, labelIds=[]): Promise<{rows, total}>

// 스냅 연결 상품
getSnapProducts(snapId): Promise<SnapProductRow[]>

// 라벨 마스터
getSnapLabels(): Promise<LabelMaster[]>

// 프로필 랭킹 (profileType: 'USER' | 'BRAND')
getProfileRankings(date, profileType): Promise<SnapProfileRow[]>

// 프로필의 날짜별 최근 스냅
getProfileSnaps(profileId, date): Promise<SnapRow[]>

// 상수
SNAP_STYLE_FILTERS: {value: string, label: string}[]
// = [{value:'ALL',label:'전체'}, {value:'CASUAL',label:'캐주얼'}, ...]
```

**주요 타입:**

```typescript
interface SnapRankRow {
  snap_id: string;
  content_type: string;
  thumbnail_url: string | null;
  content_text: string | null;
  like_count: number; view_count: number; scrap_count: number;
  goods_click_count: number; comment_count: number; click_count: number;
  model_gender: string | null;
  model_height: number | null; model_weight: number | null;
  hashtags: string[] | null; style_label_ids: number[] | null;
  published_at: string;
  rank_position: number;
  prev_rank_position: number | null;  // null = 신규 진입
  highlight: string | null;
  gender_filter: string;
  style_filter: string;
  snapshot_date: string;
}

interface SnapProfileRow {
  id: string; profile_type: string;
  nickname: string; bio: string | null;
  profile_image_url: string | null;
  follower_count: number; snap_count: number;
  height: number | null; weight: number | null;
  badge_title: string | null;   // USER 전용
  brand_code: string | null;    // BRAND 전용
  rank_position: number;
  prev_rank_position: number | null;
  highlight: string | null;
  snapshot_date: string;
}

interface SnapProductRow {
  musinsa_no: string | null; option_name: string | null;
  product_name: string; brand_name: string; thumbnail_url: string | null;
}
```

---

## 페이지 레이아웃 명세

### 전체 구조

```
┌─ page-title ──────────────────────────────────────────────────┐
│  h1: 스냅    [총 N건 chip]    sub: 무신사 스냅 랭킹            │
└───────────────────────────────────────────────────────────────┘

┌─ 탭 네비게이션 (수평 pill-tabs) ──────────────────────────────┐
│  [스냅 랭킹]  [멤버 랭킹]  [브랜드 랭킹]  [브랜드 스냅]  [코디샵] │
└───────────────────────────────────────────────────────────────┘

┌─ 필터 바 (탭마다 다른 구성, 상단 가로 배치) ──────────────────┐
│  [날짜 input]  [스타일 pills]  [성별 pills]  [라벨 pills]  [초기화]│
└───────────────────────────────────────────────────────────────┘

┌─ 적용 필터 chips + 건수 ───────────────────────────────────────┐
│  applied: [2026-05-22 ×]  [캐주얼 ×]  [여성 ×]     N건        │
└───────────────────────────────────────────────────────────────┘

┌─ 메인 컨텐츠 영역 ─────────────────────────────────────────────┐
│  (탭에 따라 테이블 or 그리드 + 우측 프로필 패널)               │
└───────────────────────────────────────────────────────────────┘
```

> 기존 좌측 280px 필터 레일은 제거한다. 상단 가로 필터 바로 교체.
> 이유: 스냅 페이지는 이미지 중심이므로 컨텐츠 영역을 최대화해야 한다.

---

## 탭별 상세 명세

### TAB 1 — 스냅 랭킹 (`style_filter` 기반)

**필터 바:**
- 날짜 input (기본값: `getLatestSnapDate()`)
- 스타일 pills: `SNAP_STYLE_FILTERS` 7개 (전체 / 캐주얼 / 스트릿 / 미니멀 / 걸리시 / 로맨틱 / 시크)
- 성별 pills: 전체 / 여성 / 남성

**테이블 컬럼:**
```
순위 | 변동 | 사진 | 스냅ID | 모델 | 등록일 | 좋아요 | 조회 | 스크랩 | 상품클릭
```
- 순위: 01~50, 1위=금색(#F59E0B), 2위=var(--f2), 3위=var(--shf)
- 변동: NEW(초록) / ▲N(초록) / ▼N(빨강) / —(변동없음)
- 사진: 기본은 IcSnap 아이콘, 클릭하면 이미지 lazy-load (36×48px, 3:4 비율)
- 모델: 성별 + 키 + 몸무게 (있는 것만, e.g. "여성 168cm 50kg")
- 숫자: 1000 이상 `1.2k` 포맷
- 행 클릭 → SnapModal 오픈

**스타일 pill 선택 시:** `getUserSnapRankings(date, gender, [], style)` 재호출

---

### TAB 2 — 멤버 랭킹 (`profile_type='USER'`)

**필터 바:** 날짜 input만

**테이블 컬럼:**
```
순위 | 변동 | 아바타+닉네임 | 뱃지 | 팔로워 | 게시물 수
```
- 아바타: 28px 원형, 없으면 회색 원
- 뱃지: `badge_title` (null이면 —)
- 행 클릭 → **우측 프로필 패널** 슬라이드인 (아래 명세 참고)

**데이터:** `getProfileRankings(date, 'USER')`

---

### TAB 3 — 브랜드 랭킹 (`profile_type='BRAND'`)

**필터 바:** 날짜 input만

**테이블 컬럼:**
```
순위 | 변동 | 아바타+브랜드명 | 브랜드코드 | 팔로워 | 게시물 수
```
- 브랜드코드: `brand_code` (null이면 —), monospace 소문자
- 행 클릭 → 우측 프로필 패널

**데이터:** `getProfileRankings(date, 'BRAND')`

---

### TAB 4 — 브랜드 스냅 (`content_type='BRAND_SNAP'`)

**필터 바:** 정렬 pills (최신순 / 좋아요순 / 조회순) + 라벨 필터

**라벨 필터:** `getSnapLabels()` 로 카테고리별(계절/스타일/TPO) 구분, 다중 선택 가능

**테이블 컬럼:**
```
사진 | 스냅ID | 등록일 | 좋아요 | 조회 | 스크랩 | 상품클릭
```
- 페이지네이션: 50건/페이지
- 데이터: `getBrandSnaps(page, sort, labelIds)`

---

### TAB 5 — 코디샵 (`content_type='CODISHOP_SNAP'`)

브랜드 스냅과 동일한 구조.
- 데이터: `getCodishopSnaps(page, sort, labelIds)`

---

## 우측 프로필 패널 (멤버/브랜드 랭킹 탭 전용)

```
┌─ fixed right panel (360px, height: 100vh) ─────────────────┐
│  ┌─ 헤더 ──────────────────────────────────────────────── ┐ │
│  │ [아바타 44px] 닉네임                         [X 버튼]   │ │
│  │              #순위  뱃지or브랜드코드                    │ │
│  └─────────────────────────────────────────────────────── ┘ │
│                                                              │
│  ┌─ 소개글 (있을 때만, 최대 3줄 말줄임) ──────────────── ┐  │
│  └─────────────────────────────────────────────────────── ┘  │
│                                                              │
│  ┌─ 스탯 2열 ──────────────────────────────────────────── ┐ │
│  │  팔로워    │  게시물                                    │ │
│  │  12,345    │   87                                      │ │
│  └─────────────────────────────────────────────────────── ┘ │
│                                                              │
│  ┌─ 최근 스냅 (2열 그리드) ────────────────────────────── ┐ │
│  │  RECENT SNAPS         (로딩 중이면 skeleton)           │ │
│  │  ┌──────┐ ┌──────┐                                    │ │
│  │  │thumb │ │thumb │  ← aspectRatio: 3/4                │ │
│  │  │❤ 1.2k│ │❤ 800 │  ← 좋아요 overlay (우하단)        │ │
│  │  └──────┘ └──────┘                                    │ │
│  │  ┌──────┐ ┌──────┐                                    │ │
│  │  │thumb │ │thumb │  ← 클릭 → SnapModal                │ │
│  │  └──────┘ └──────┘                                    │ │
│  └─────────────────────────────────────────────────────── ┘ │
└─────────────────────────────────────────────────────────────┘
```

- **데이터:** `getProfileSnaps(profile.id, date)` (최대 10개)
- 같은 행 재클릭 → 패널 닫힘
- 패널 열릴 때 메인 컨텐츠 영역은 오른쪽으로 360px 밀리지 않고 겹침 (fixed position)
- ESC 키로 닫힘

---

## SnapModal (스냅 상세 팝업)

스냅 행 클릭 / 프로필 패널 스냅 썸네일 클릭 시 오픈.

```
┌─ Modal (580px wide, center) ───────────────────────────────┐
│  헤더: [컨텐츠 타입] [#순위] [변동] ──────────── [X]       │
│                                                              │
│  ┌─────────────────┬──────────────────────────────────── ┐ │
│  │ 썸네일           │ 날짜   snap_id (뒤 12자리)           │ │
│  │ (180px, 클릭     │                                      │ │
│  │  하면 이미지      │ MODEL: 성별 키 몸무게 피부톤          │ │
│  │  로드)            │                                      │ │
│  │                  │ DESCRIPTION: (최대 4줄, 더보기)       │ │
│  │                  │                                      │ │
│  │                  │ TAGS: #tag1 #tag2 ...                │ │
│  │                  │                                      │ │
│  │                  │ STATS:                               │ │
│  │                  │  ❤ 좋아요  N      👁 조회수  N       │ │
│  │                  │  🔖 스크랩 N      🛍 상품클릭 N      │ │
│  │                  │  💬 댓글   N      👆 클릭    N       │ │
│  └─────────────────┴──────────────────────────────────── ┘ │
│                                                              │
│  연결 상품 (N건):                                            │
│  [thumb] 상품명                              브랜드 #품번   │
│  [thumb] 상품명                              브랜드 #품번   │
└─────────────────────────────────────────────────────────────┘
```

- 배경 클릭 / ESC → 닫힘
- `getSnapProducts(snap_id)` 로 연결 상품 로드
- 썸네일 없으면 IcSnap 아이콘 표시

---

## 필터 바 구성 (탭별)

| 탭 | 표시 필터 |
|---|---|
| 스냅 랭킹 | 날짜 + 스타일 7개 pills + 성별 pills |
| 멤버 랭킹 | 날짜 |
| 브랜드 랭킹 | 날짜 |
| 브랜드 스냅 | 정렬 pills + 라벨 pills (계절/스타일/TPO 3그룹) |
| 코디샵 | 정렬 pills + 라벨 pills (동일) |

라벨 필터는 `FilterBlock` 컴포넌트로 카테고리명을 label로 사용.
다중 선택 가능, 선택된 라벨은 applied chips에 표시.

---

## 디자인 규칙 — 절대 위반 금지

```
❌ CSS hex 값 직접 사용 금지 → var(--f1) / var(--bs) / var(--sur) 등 CSS 변수만
❌ Supabase 직접 호출 금지 → queries-snap.ts 함수만 사용
❌ mock 데이터 금지 → 빈 상태는 "no data" 메시지
```

**사용 가능한 CSS 변수 (globals.css 에서 확인):**
- 텍스트: `var(--f1)` 본문 / `var(--f2)` 보조 / `var(--f3)` 희미 / `var(--f4)` 최희미
- 배경: `var(--sur)` 카드 / `var(--rai)` skeleton / `var(--snk)` 이미지 placeholder
- 테두리: `var(--bs)` 구분선 / `var(--bd)` 버튼 테두리
- 강조: `var(--hs)` 선택색 / `var(--hs-soft)` 선택 배경 / `var(--tu)` 상승(초록) / `var(--td)` 하강(빨강)
- 폰트: `var(--mono)` monospace / `var(--sans)` sans-serif

**사용 가능한 className:**
- `row`, `row head`, `row hover`, `row alt`, `row active`
- `mono`, `dim`, `muted`, `ellip`, `cell-r`
- `chip`, `chip mono`, `sec-tag`
- `panel`, `tbl`
- `page-title`, `sub`
- `btn`, `btn sm`, `btn sm icon`, `btn active`
- `filter-rail`, `frh`, `frb` (필터 바 레이아웃)
- `grid`, `col-flex`, `row-flex`, `gap-4`, `gap-6`, `gap-10`, `flex-1`
- `center`, `between`, `wrap`

**사용 가능한 컴포넌트:**
- `FilterBlock` — 라벨 + 내부 컨텐츠 블록 (`label` prop)
- `PillGroup` — radio-style pill 선택 (`value`, `onChange`, `options: [value, label][]`)
- `DismissChip` — 닫기 버튼 있는 chip (`onDismiss`)
- `IcSnap`, `IcX`, `IcChevL`, `IcChevR` (from `@/components/ui/icons`)

---

## 로딩·에러·빈 상태 처리

- 로딩: skeleton rows (height: 14px, background: var(--rai), borderRadius: 3)
- 에러: 빨간 배경 알림 박스 (var(--shb)), 텍스트 var(--shf)
- 빈 데이터: `<span className="sec-tag">no data</span>` + 안내 메시지

---

## 출력물

`viewer/src/app/(app)/snap/page.tsx` 파일 하나만 작성.
`queries-snap.ts` 는 수정하지 않는다.
TypeScript 타입 에러 없이 컴파일되어야 한다.
