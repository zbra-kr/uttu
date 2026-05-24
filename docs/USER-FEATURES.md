# UTTU 사용자 기능 정리

마이페이지(/me) 구현 과정에서 함께 추가된 엔티티 페이지 공통 기능 및 백그라운드 기능.
각 기능은 독립적으로 동작하며 `/me` 마이페이지와 연동된다.

---

## 1. 메모 (NoteDrawer)

### 개요
브랜드·회사·상품·랭킹 필터 4개 페이지에서 자유 텍스트 메모를 작성하고 팀원을 @멘션할 수 있는 기능.

### DB 테이블
| 테이블 | 역할 |
|---|---|
| `user_notes` | 메모 본문, entity 연결, 태그, 멘션 대상 저장 |
| `user_notifications` | @멘션 수신 알림 |

### 컴포넌트
- `viewer/src/components/me/NoteDrawer.tsx` — 슬라이드 드로어. 메모 목록 + 작성 + 수정 + 삭제
- `viewer/src/app/api/me/notes/notify-mentions/route.ts` — @멘션 발생 시 Teams webhook + DB 알림 INSERT

### 연동 페이지
| 페이지 | entity_type | entity_id |
|---|---|---|
| `/brand` | `brand` | brands.id (UUID) |
| `/company` | `company` | companies.id (UUID) |
| `/product` | `product` | products.id (UUID) |
| `/ranking` | `ranking_filter` | `age=…&category=…&gender=…&period=…` 직렬화 문자열 |

### 동작
- 페이지 우측 상단 **메모** 버튼 → NoteDrawer 열림
- 작성 시 `@이름` 입력 → 팀원/팀 검색 드롭다운 → 멘션 대상 지정
- 메모 작성 완료 시 멘션 대상에게 Teams webhook 알림 + DB 알림 INSERT
- 메모가 있으면 버튼에 카운트 뱃지 표시

### queries-me.ts 주요 함수
```typescript
fetchNotesForEntity(entity_type, entity_id)   // 특정 엔티티 메모 목록
createNote({ body, entity_type, entity_id, tags, mentioned_user_ids })
updateNote(id, patch)
deleteNote(id)
fetchMyRecentNotes(limit)   // /me 내 메모 섹션용
fetchMentionsForMe(limit)   // /me 받은 멘션 섹션용
searchMentionCandidates(query)  // @멘션 자동완성
```

---

## 2. 북마크 (BookmarkToggle)

### 개요
브랜드·회사·상품 페이지에서 별 아이콘으로 북마크를 토글. `/me` 북마크 섹션에서 모아 보기.

### DB 테이블
| 테이블 | 역할 |
|---|---|
| `user_bookmarks` | entity_type + entity_id + label 저장, RLS로 본인만 |

### 컴포넌트
- `viewer/src/components/me/BookmarkToggle.tsx`
  - props: `entity_type`, `entity_id`, `label`, `size`, `className`
  - 마운트 시 `isBookmarked()` 호출 → 상태 표시
  - 클릭 시 `addBookmark` / `removeBookmark` 토글
  - 북마크 활성 상태: 별 아이콘 amber fill + border

### 연동 페이지
| 페이지 | entity_type | label |
|---|---|---|
| `/brand` | `brand` | 브랜드명 |
| `/company` | `company` | 회사명 |
| `/product` | `product` | 상품명 |

### queries-me.ts 주요 함수
```typescript
isBookmarked(entity_type, entity_id)
addBookmark(entity_type, entity_id, label?)
removeBookmark(entity_type, entity_id)
fetchBookmarks()   // /me 북마크 섹션용
```

---

## 3. 조회 기록 (logView)

### 개요
엔티티 페이지 진입 시 자동으로 기록. `/me`의 "최근 본" 섹션에 최신 8건 표시. 사용자당 최대 50건 롤링.

### DB 테이블
| 테이블/함수 | 역할 |
|---|---|
| `user_view_history` | entity_type, entity_id, label, viewed_at 저장 |
| `upsert_view_history(p_entity_type, p_entity_id, p_label)` | 동일 엔티티 재방문 시 viewed_at 갱신, 신규면 INSERT 후 50건 초과분 삭제 |

### 연동 페이지 & 트리거 조건
| 페이지 | 트리거 | deps |
|---|---|---|
| `/brand` | 브랜드 정보 로드 완료 후 | `[selectedId, info?.name]` |
| `/company` | 회사 정보 로드 완료 후 | `[idFromUrl, info?.corp_name]` |
| `/product` | 상품 상세 로드 완료 후 | `[detail?.id]` |
| `/ranking` | 필터 변경 후 300ms 디바운스 | `[rankingEntityId]` |

### 구현 위치
`viewer/src/lib/queries-me.ts`
```typescript
logView(entity_type, entity_id, label?)   // RPC 호출
fetchViewHistory(limit = 8)               // /me 최근 본 섹션용
```

---

## 4. 저장 필터 (SavedFiltersDropdown)

### 개요
필터 레일에 "불러오기 / 저장" UI를 추가. 자주 쓰는 필터 조합을 이름 붙여 DB에 저장하고 클릭 한 번으로 복원.

### DB 테이블
| 테이블 | 역할 |
|---|---|
| `user_saved_filters` | page, name, filter_data (JSONB), UNIQUE(user_id, page, name) |

### 컴포넌트
`viewer/src/components/me/SavedFiltersDropdown.tsx`

**props:**
```typescript
{
  page: string;              // '/ranking' | '/anomaly' | '/promo' | '/reviews'
  currentFilter: unknown;    // 현재 필터 state (JSON 직렬화 가능)
  onLoad: (filter: unknown) => void;
}
```

**UI 동작:**
- **불러오기 ▾** — 드롭다운으로 저장 목록 표시. 클릭 시 `onLoad` 호출 → 각 페이지 state setter로 복원
- **저장** — inline input 펼쳐 이름 입력 → 확인. 같은 이름 있으면 "덮어쓸까요?" 확인 후 overwrite
- 각 항목 hover 시 × 삭제 버튼 노출

### 연동 페이지
| 페이지 | 저장되는 필터 항목 |
|---|---|
| `/ranking` | period, category, gender, age, price, companies, brands, ownOnly, moverOnly, sort, sortDir |
| `/anomaly` | period, fromDate, toDate, sev[], area[], status |
| `/promo` | period, customFrom, customTo, typeFilters[], statusFilter, brandFilter[], sortBy |
| `/reviews` | target, period, fromDate, toDate, ratingFrom, ratingTo, categories[], companies[], brands[], keyword, sort |

### queries-me.ts 주요 함수
```typescript
fetchSavedFilters(page)                       // 특정 페이지 본인 목록 (max 20)
fetchAllSavedFilters()                        // /me 전체 목록
saveFilter(page, name, filter_data)           // INSERT, UNIQUE 충돌 시 한글 에러
overwriteFilter(id, filter_data)              // 같은 이름 덮어쓰기 UPDATE
deleteSavedFilter(id)                         // DELETE
```

---

## 5. 북마크 랭킹 변동 알림 (bookmark_detector)

### 개요
매일 실행되는 Worker가 북마크된 브랜드/상품의 전일 대비 랭킹 변동을 감지해 구독자에게 알림 INSERT.

### 위치
`worker/detectors/bookmark_detector.py`

### 동작 흐름
1. `user_bookmarks`에서 `entity_type IN ('brand', 'product')` 전체 조회
2. 각 사용자의 `rank_change_bookmarked` / `teams` 채널 구독 여부 확인 (캐시)
3. 오늘 같은 entity_id 알림 이미 있으면 skip (중복 방지)
4. **브랜드**: `brand_ranking_snapshots` 에서 category=000, age=AGE_BAND_ALL, 어제 vs 오늘 비교 → `|Δ| ≥ 10` 인 조합 최대 1건 선택
5. **상품**: `ranking_snapshots` 에서 rank ≤ 100 기준 TOP100 신규 진입 / 전면 이탈만 감지
6. 조건 충족 시 `enqueue_notification()` 호출 → `user_notifications` INSERT

### 실행 진입점
`worker/detectors/runner.py` — `run()` 함수 마지막에 `detect_bookmark_changes()` 호출

### 알림 event_type
`rank_change_bookmarked`

### 구독 설정
`/me` → 알림 구독 섹션 → "순위 변동 (북마크)" 행에서 Teams 채널 켜기

---

## 6. 마이페이지 통계 API

### 위치
`viewer/src/app/api/me/stats/route.ts`

### 응답 형태 (GET `/api/me/stats`)
```json
{
  "bookmarks": 12,
  "bookmarks_recent_7d": 3,
  "notes": 8,
  "notes_recent_7d": 1,
  "view_history": 42,
  "view_history_recent_7d": 15,
  "saved_filters": 5,
  "active_subscriptions": 4,
  "active_subscription_events": 3,
  "mentions_received_30d": 2
}
```

- 비인증 요청 → `401`
- `supabaseServer()` (anon + RLS) 사용 — service_role 없음
- 10개 count 쿼리 `Promise.all` 병렬 처리

---

## 공통 설계 원칙

### RLS
모든 사용자 데이터 테이블(`user_bookmarks`, `user_notes`, `user_view_history`, `user_saved_filters`, `user_notifications`, `user_notification_subscriptions`)은 `user_id = auth.uid()` 정책 적용. 타인 데이터 열람/수정 불가.

### entity_type ENUM
```sql
'company' | 'brand' | 'product' | 'ranking_filter'
```
메모·북마크·조회기록이 동일 ENUM을 공유하므로 `/me`에서 일관된 링크 생성 가능.

### ranking_filter entity_id 직렬화 규칙
```
age={value}&category={value}&gender={value}&period={value}
```
알파벳 순 정렬 고정. 메모·북마크·조회기록이 동일 key를 사용하므로 변경 금지.

### 브라우저 클라이언트
`supabaseBrowser()` — viewer 전용 anon 키, RLS 적용.
`service_role` 키는 worker Python 코드 및 `/api/me/notes/notify-mentions` 한 곳에서만 사용.
