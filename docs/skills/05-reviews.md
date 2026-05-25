# Skill 05 — 리뷰 수집 (자사 브랜드 전용)

> 리뷰 관련 모든 작업 전 이 파일을 읽어라.

---

## 수집 대상

```
자사 브랜드만: CO(커버낫) · LE(리) · WA(와키윌리)
경쟁사 리뷰 수집 금지
```

---

## 수집 모드

| 모드 | 명령 | 대상 | 용도 |
|---|---|---|---|
| **backfill** | `--backfill` | is_own=True 전체 (연도 무관) | 최초 1회성 전수 수집 |
| **daily** | (인수 없음) | ranking_snapshots 최근 30일 등장 상품 | 매일 cron 증분 |

---

## 수집 필드 (개인정보보호법 기준)

```
✅ 수집:
  - rating           별점 (1~5)
  - review_text      본문
  - review_date      작성일자 (DATE)
  - helpful_count    도움됐어요 수
  - musinsa_review_id  고유 ID (UNIQUE — 중복방지 키)
  - has_image        이미지 첨부 여부
  - image_urls       CDN URL 배열
  - purchase_option  구매 옵션 (예: WS, M/BLACK) — goodsOption
  - member_height    키(cm) — userProfileInfo.userHeight
  - member_weight    몸무게(kg) — userProfileInfo.userWeight
  - member_gender    성별 (남성/여성) — userProfileInfo.reviewSex
  - satisfactions    만족도 항목 JSONB — [{attribute, answer}, ...]
  - is_experience    체험단 여부 — specialtyCodes 비어있으면 false

❌ 수집 금지 (개인정보):
  - userNickName     닉네임
  - userId           사용자 ID
  - encryptedUserId  암호화 사용자 ID
  - userImageFile    프로필 이미지
```

### satisfactions 구조 예시

```json
[
  {"attribute": "사이즈", "answer": "정사이즈"},
  {"attribute": "화면 대비 색감", "answer": "화면과 비슷"},
  {"attribute": "두께감", "answer": "적당함"},
  {"attribute": "신축성", "answer": "적당함"}
]
```

---

## API

```
URL: https://api.musinsa.com/api2/review/v1/view/list
파라미터: goodsNo={musinsa_no}&page={n}&pageSize=20
인증: 불필요 (쿠키 없이 200 반환)
pageSize 최대 20 — 50 이상은 HTTP 400
```

---

## backfill 수집 동작

```
1. ~/.uttu_backfill_started 마커파일에 시작 시각 기록
2. review_checked_at IS NULL 상품 먼저, 이후 나머지 순 (review_count 많은 순)
3. review_checked_at >= backfill_started 상품은 스킵 (이미 처리됨)
4. 각 상품: 전체 페이지 수집 (last_date 무시, full_collect=True)
5. 완료 시 마커파일 삭제
```

재시작 시: 마커파일이 남아있으면 기존 시작 시각 사용 → 이미 처리된 상품 자동 스킵.

---

## daily 수집 동작

```
1. ranking_snapshots 최근 30일 + is_sold_out=False → 활성 product_id 집합
2. is_own=True + 1일 내 미체크 상품만 대상
3. _get_last_review_date() 이후 신규 리뷰만 수집 (incremental)
4. review_count 많은 순 처리
```

---

## 실행

```bash
# backfill (1회성 전체 수집 — nohup 백그라운드 권장)
nohup ./scripts/run_reviews.sh --backfill > logs/review_backfill.log 2>&1 &

# daily (cron용 증분)
./scripts/run_reviews.sh

# 테스트
./scripts/run_reviews.sh --limit 5
./scripts/run_reviews.sh --backfill --limit 3
```

---

## 증분 로직 핵심

```python
# run_product(full_collect=False) — daily 모드
last_date = self._get_last_review_date(product_id)  # DB 최신 리뷰 날짜
for page in ...:
    for item in items:
        if last_date and review_date < last_date:
            stop_early = True; break   # 이미 수집한 날짜 도달 → 중단
        rows.append(_parse_review(item, product_id))

# run_product(full_collect=True) — backfill 모드
last_date = None  # 날짜 무시, 전체 페이지 수집
```

---

## upsert 패턴

```python
client.table("reviews").upsert(
    rows,
    on_conflict="musinsa_review_id",
    ignore_duplicates=True   # 중복이면 UPDATE 없이 skip
).execute()
```

---

## LLM 분석 연계 (review_analysis)

```python
async def analyze_reviews(client, product_id: str, model: str = "gemma4:e4b"):
    low  = client.table("reviews").select("review_text,rating").eq("product_id", product_id).lte("rating", 2).limit(200).execute()
    high = client.table("reviews").select("review_text,rating").eq("product_id", product_id).gte("rating", 4).limit(200).execute()
    # → review_analysis 테이블 upsert (on_conflict="product_id,analysis_date")
```

---

## Cron (정호철 직접 등록)

```bash
# 리뷰 daily 증분 — 매일 04:00 (상품 상세 수집 후)
0 4 * * * /Users/macmini/projects/uttu/scripts/run_reviews.sh >> /Users/macmini/projects/uttu/logs/reviews_$(date +\%Y\%m\%d).log 2>&1
```
