# Skill 03 — Snowflake ERP 연동

> Snowflake 관련 모든 작업 전 이 파일을 읽어라.

---

## 연결 정보

```
Account:   A7267140136571-BCAVE_ADMIN
User:      BI
Warehouse: BCAVE_WH
Database:  BCAVE
Schema:    SEWON
Role:      BI
인증:      Key-pair (PKCS8 PEM, ENCRYPTED)
```

---

## Key-pair 인증 패턴

```python
# worker/matchers/snowflake_pull.py

import os
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
import snowflake.connector

def _load_private_key() -> bytes:
    """암호화된 PEM 파일 → DER 바이트 변환"""
    key_path = os.environ["SNOWFLAKE_PRIVATE_KEY_PATH"]
    passphrase = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PASSPHRASE")

    with open(key_path, "rb") as f:
        p_key = serialization.load_pem_private_key(
            f.read(),
            password=passphrase.encode() if passphrase else None,
            backend=default_backend()
        )

    return p_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )

def get_snowflake_conn():
    """Snowflake 연결 반환 (read-only 서비스 계정)"""
    return snowflake.connector.connect(
        user=os.environ["SNOWFLAKE_USER"],
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        private_key=_load_private_key(),
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
        database=os.environ["SNOWFLAKE_DATABASE"],
        schema=os.environ["SNOWFLAKE_SCHEMA"],
        role=os.environ.get("SNOWFLAKE_ROLE", "BI"),
    )
```

---

## 핵심 테이블 스키마

### SW_STYLEINFO — 상품 마스터 (21,232행)

| 컬럼 | 내용 |
|---|---|
| STYLECD | SKU 코드 (예: CO2602STE1) |
| STYLENM | 상품명 |
| BRANDCD | 브랜드 코드 (CO/LE/WA) |
| ITEMNM | 카테고리명 |
| GENDERNM | 성별 |
| TAGPRICE | 정상가 |
| PRODCOST | 원가 |
| YEARCD | 연도 |
| SEASONNM | 시즌 |

### SW_SALEINFO — 판매 트랜잭션 (3,072만행)

| 컬럼 | 내용 |
|---|---|
| SALEDT | 날짜 (TEXT, YYYYMMDD) |
| BRANDCD | 브랜드 코드 |
| SHOPNM | 매장명/채널명 |
| STYLECD | SKU 코드 |
| COLORCD | 색상 코드 |
| SIZECD | 사이즈 |
| SALEGBNM | 판매구분 (판매/반품) |
| SALETYPENM | 판매유형 (정상/세일) |
| SALEPRICE | 판매가 |
| SALEQTY | 수량 |
| SALEAMT | 판매금액 |
| DCAMT | 할인금액 |
| SALERATE | 할인율 |
| ONORDPATH | 온라인 경로 |

**필수 필터**: `length(SALEDT) = 8` (날짜 형식 이상 행 제외)

### SW_WHINV — 재고 현황

| 컬럼 | 내용 |
|---|---|
| STYLECD | SKU 코드 |
| COLORCD | 색상 코드 |
| SIZECD | 사이즈 |
| AVAILQTY | 가용재고 |
| ONLINEQTY | 온라인재고 |
| OFFLINEQTY | 오프라인재고 |

---

## 자사 브랜드 코드

| 코드 | 브랜드 |
|---|---|
| CO | 커버낫 (Covernat) |
| LE | 리 (LEE) |
| WA | 와키윌리 (WakiWilly) |

---

## 채널 분류 함수

```python
def classify_channel(shop_name: str) -> str:
    """SHOPNM → channel_type 분류"""
    name = (shop_name or '').strip()
    if '무신사' in name and '오프라인' not in name:
        return 'musinsa_online'
    if '플래그쉽' in name or '플래그십' in name:
        return 'flagship'
    if any(k in name for k in ['면세', '신라', '롯데면세', '신세계면세']):
        return 'dept_duty_free'
    if '홈페이지' in name or '공식' in name:
        return 'official_web'
    if '티몰' in name or 'TMALL' in name.upper():
        return 'tmall'
    if '쿠팡' in name:
        return 'coupang'
    if '대만' in name or 'TAIWAN' in name.upper():
        return 'taiwan'
    if '29CM' in name or '29cm' in name:
        return '29cm'
    return 'etc'
```

---

## 집계 쿼리 패턴 (Supabase 적재용)

```sql
-- 일별 매출 집계 (Snowflake에서 집계 후 Supabase에 소량 적재)
SELECT
  SALEDT                               AS sale_date,
  BRANDCD                              AS brand_code,
  BRANDNM                              AS brand_name,
  SHOPNM                               AS shop_name,
  SUM(CASE WHEN SALEGBNM = '판매' THEN SALEQTY ELSE 0 END) AS sale_qty,
  SUM(CASE WHEN SALEGBNM = '판매' THEN SALEAMT ELSE 0 END) AS sale_amt,
  SUM(CASE WHEN SALEGBNM = '반품' THEN SALEQTY ELSE 0 END) AS return_qty,
  SUM(CASE WHEN SALEGBNM = '반품' THEN SALEAMT ELSE 0 END) AS return_amt,
  AVG(CASE WHEN SALEGBNM = '판매' AND SALERATE IS NOT NULL
           THEN SALERATE END)                               AS avg_discount_rate
FROM BCAVE.SEWON.SW_SALEINFO
WHERE BRANDCD IN ('CO', 'LE', 'WA')
  AND SALEDT = '{target_date}'
  AND LENGTH(SALEDT) = 8
GROUP BY SALEDT, BRANDCD, BRANDNM, SHOPNM
```

---

## 규칙

```
✅ read-only — 절대 INSERT/UPDATE/DELETE 금지
✅ 집계 후 소량만 Supabase에 적재 (원본 3,072만행 적재 금지)
✅ 연결 후 반드시 close()
✅ 쿼리 타임아웃 설정 (대용량 테이블)
```

---

## 환경변수

```
SNOWFLAKE_ACCOUNT=A7267140136571-BCAVE_ADMIN
SNOWFLAKE_USER=BI
SNOWFLAKE_PRIVATE_KEY_PATH=/Users/macmini/projects/uttu/.secret/pbi_it_svc_pkcs8.pem
SNOWFLAKE_PRIVATE_KEY_PASSPHRASE=<passphrase>
SNOWFLAKE_WAREHOUSE=BCAVE_WH
SNOWFLAKE_DATABASE=BCAVE
SNOWFLAKE_SCHEMA=SEWON
SNOWFLAKE_ROLE=BI
```
