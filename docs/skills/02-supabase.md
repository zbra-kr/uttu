# Skill 02 — Supabase DB 패턴

> DB 관련 모든 작업 전 이 파일을 읽어라.

---

## 핵심 제약사항

### PostgREST 1,000행 기본 상한

```typescript
// ❌ 금지 — 1,000행만 반환됨
const { data } = await supabase.from('ranking_snapshots').select('*');

// ✅ 올바름 — limit 명시
const { data } = await supabase.from('ranking_snapshots').select('*').limit(200);

// ✅ 페이지네이션
const { data } = await supabase.from('ranking_snapshots')
  .select('*')
  .range(0, 99);   // 100건
```

### error 반드시 처리

```typescript
// ❌ 금지 — 빈 화면 버그의 원인
const { data } = await query;

// ✅ 올바름
const { data, error } = await query;
if (error) {
  console.error('[컴포넌트] 쿼리 실패', error);
  return <ErrorState description={error.message} />;
}
if (!data || data.length === 0) {
  return <EmptyState title="데이터가 없습니다" />;
}
```

---

## LATERAL JOIN 패턴 (최신 스냅샷 조회)

```sql
-- 상품별 최신 랭킹·가격 조회
SELECT
  p.id,
  p.name,
  p.brand_id,
  rs.rank_position,
  rs.list_price,
  rs.snapshot_date
FROM products p
LEFT JOIN LATERAL (
  SELECT rank_position, list_price, snapshot_date
  FROM ranking_snapshots rs
  WHERE rs.product_id = p.id
    AND rs.category_code = '000'
    AND rs.gender_filter = 'A'
    AND rs.age_filter = 'A'
  ORDER BY rs.snapshot_date DESC
  LIMIT 1
) rs ON true
WHERE p.brand_id = $1
```

TypeScript (Supabase):
```typescript
// LATERAL은 rpc() 또는 raw SQL로만 가능
const { data, error } = await supabase.rpc('get_brand_rankings', {
  p_brand_id: brandId,
  p_category: '000',
  p_gender: 'A',
  p_age: 'A'
});
```

---

## RLS 정책 패턴

```sql
-- 모든 테이블 공통 패턴
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;

-- anon: 읽기만
CREATE POLICY "anon read {table}"
  ON {table} FOR SELECT TO anon USING (true);

-- service_role: RLS bypass (별도 정책 불필요)
-- authenticated: 추후 추가
```

---

## Upsert 패턴

### Python worker

```python
def upsert_ranking_snapshots(client, rows: list[dict], batch_size=500) -> int:
    """ranking_snapshots bulk upsert"""
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        result = client.table("ranking_snapshots").upsert(
            batch,
            on_conflict="product_id,snapshot_date,category_code,gender_filter,age_filter"
        ).execute()
        total += len(result.data or [])
    return total
```

### musinsa_no → product_id 변환 패턴

```python
def get_product_id_map(client, musinsa_nos: list[str]) -> dict[str, str]:
    """musinsa_no → product_id 변환 (1000건씩 배치)"""
    id_map = {}
    for i in range(0, len(musinsa_nos), 1000):
        chunk = musinsa_nos[i:i+1000]
        result = client.table("products") \
            .select("id, musinsa_no") \
            .in_("musinsa_no", chunk) \
            .execute()
        for row in (result.data or []):
            id_map[row["musinsa_no"]] = row["id"]
    return id_map
```

---

## 마이그레이션 규칙

```
1. 파일명: NNNNN_description.sql (5자리 번호)
2. SQL Editor에서 정호철이 수동 적용
3. 자동 적용 절대 금지
4. 적용 전 백업 확인
5. 롤백 SQL도 함께 작성 권장
```

---

## KST 날짜 패턴

```typescript
// Next.js에서 오늘 날짜 (KST 기준)
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
// 결과: "2026-05-19"
```

```python
# Python에서 오늘 날짜 (KST 기준)
from datetime import datetime
import pytz
KST = pytz.timezone("Asia/Seoul")
today = datetime.now(KST).strftime("%Y-%m-%d")
```

---

## 인덱스 전략

```sql
-- ranking_snapshots 핵심 인덱스
CREATE INDEX ranking_date_cat_idx
  ON ranking_snapshots(snapshot_date DESC, category_code);

CREATE INDEX ranking_gender_age_idx
  ON ranking_snapshots(gender_filter, age_filter, snapshot_date DESC);

CREATE INDEX ranking_top50_idx
  ON ranking_snapshots(category_code, gender_filter, age_filter, rank_position)
  WHERE rank_position <= 50;

-- reviews 핵심 인덱스
CREATE INDEX reviews_low_rating_idx
  ON reviews(product_id, rating)
  WHERE rating <= 2;

CREATE INDEX reviews_high_rating_idx
  ON reviews(product_id, rating)
  WHERE rating >= 4;
```

---

## 환경변수

```
# Worker (service_role — viewer에 절대 사용 금지)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Viewer (anon key만 사용)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_USE_MOCK=false   ← 이 값이 없으면 mock 모드 동작!
```
