# 브랜드(brands) 테이블 설계

> 2026-05-19 실측 기반. 수집 가능 항목 전수 조사 후 선택 항목만 반영.

---

## 수집 방법

| 단계 | 트리거 | 방법 | 속도 |
|---|---|---|---|
| **자동 등록** | 랭킹 수집 시 신규 브랜드 발견 | brand ranking API → slug + name + logo_url | 0초 (랭킹 수집 중 처리) |
| **상세 수집** | 미수집 브랜드 배치 처리 | httpx → www.musinsa.com/brand/{slug} | ~1초/브랜드 |

**상세 URL**: `https://www.musinsa.com/brand/{slug}`
**파싱 대상**: HTML 내 `__NEXT_DATA__.props.pageProps.meta` JSON

> Playwright 불필요. 팔로워 수·상품 수는 클라이언트 사이드 렌더링으로 수집 불가.

---

## 샘플 링크

```
https://www.musinsa.com/brand/musinsastandard   ← 무신사 스탠다드 (랭킹 1위)
https://www.musinsa.com/brand/adidas            ← 아디다스
https://www.musinsa.com/brand/covernat          ← 커버낫 (자사 브랜드 유형)
https://www.musinsa.com/brand/anderssonbell     ← 앤더슨벨
```

---

## 수집 가능 전체 항목

### 브랜드 페이지 HTML (`__NEXT_DATA__.props.pageProps.meta`)

| 필드 (API) | 타입 | 예시 | 비고 |
|---|---|---|---|
| `brand` | string | "musinsastandard" | slug (PK) |
| `brandName` | string | "무신사 스탠다드" | 한글명 |
| `brandNameEng` | string | "MUSINSA STANDARD" | 영문명 |
| `brandNation` | string | "korea" | 국가 코드 |
| `brandNationName` | string | "한국" | 국가명 |
| `since` | int | 2017 | 설립 연도 |
| `introduction` | string | "무신사 스탠다드(MUSINSA STANDARD)는..." | 브랜드 소개글 |
| `logoImageUrl` | string | "//image.msscdn.net/..." | 컬러 로고 |
| `whiteLogoImageUrl` | string | "//image.msscdn.net/...svg" | 흰색 로고 SVG |
| `serviceType` | string | "FLAGSHIP" | 아래 참고 |
| `flagshipType` | string | "TYPE_C" | 아래 참고 |
| `isUsed` | bool | false | 중고거래 가능 |
| `goodsSortCode` | string | "NEW" | 기본 상품 정렬 |

### 브랜드 랭킹 API (수집 중 자동 획득)

| 필드 | 출처 | 예시 |
|---|---|---|
| slug | `ga4.payload.brand_id` | "adidas" |
| name | `title.title.text` | "아디다스" |
| logo_url | `title.imageUrl` | CDN URL |

### 수집 불가 항목 (클라이언트 사이드 렌더링)

| 항목 | 비고 |
|---|---|
| 팔로워 수 | XHR으로 별도 로드, 정적 HTML에 없음 |
| 등록 상품 수 | 동일 |
| 누적 판매량 | 동일 |

---

## serviceType / flagshipType 분류

| serviceType | 의미 | 실측 예시 |
|---|---|---|
| `FLAGSHIP` | 플래그십 브랜드 (직매입 또는 자체 브랜드) | musinsastandard, adidas, anderssonbell |
| `BRAND_SHOP` | 일반 브랜드샵 | covernat |

| flagshipType | 등급 | 실측 예시 |
|---|---|---|
| `TYPE_C` | 최고 등급 | musinsastandard, adidas, anderssonbell |
| `TYPE_B` | 중간 등급 | covernat |
| `TYPE_A` | 미확인 | — |

---

## 선택 항목 → brands 테이블 반영

| 항목 | 선택 | 제외 사유 |
|---|---|---|
| slug | ✅ | 기존 유지 |
| name (한글) | ✅ | 기존 유지 |
| name_eng | ✅ 추가 | — |
| logo_url | ✅ | 기존 brand_image_url → logo_url 정리 |
| white_logo_url | ✅ 추가 | 뷰어 다크모드 대응 |
| nation_code | ✅ 추가 | 해외/국내 브랜드 구분 |
| nation_name | ✅ 추가 | — |
| since_year | ✅ 추가 | 브랜드 연혁 |
| introduction | ✅ 추가 | 브랜드 설명 (Viewer 표시용) |
| service_type | ✅ 추가 | FLAGSHIP vs BRAND_SHOP |
| flagship_type | ✅ 추가 | 등급 정보 |
| is_used | ✅ 추가 | 중고거래 여부 |
| goodsSortCode | ❌ | 내부 UI 설정값, 분석 불필요 |
| 팔로워/상품 수 | ❌ | 수집 불가 (클라이언트 렌더링) |

---

## 마이그레이션 파일

[supabase/migrations/00002_brands.sql](../../supabase/migrations/00002_brands.sql)

---

## 스크래핑 패턴 (추후 작성)

```python
import re, json, httpx

BRAND_PAGE_URL = "https://www.musinsa.com/brand/{slug}"

async def fetch_brand_detail(slug: str) -> dict | None:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            BRAND_PAGE_URL.format(slug=slug),
            headers={"User-Agent": "Mozilla/5.0 ..."}
        )
        resp.raise_for_status()

    m = re.search(
        r'"meta"\s*:\s*(\{[^}]+\})',
        resp.text
    )
    # 또는 __NEXT_DATA__ 전체 파싱 후 pageProps.meta 추출
    ...
```

> 실제 파싱 코드는 `worker/scrapers/musinsa_brand.py` 구현 시 완성 예정.
