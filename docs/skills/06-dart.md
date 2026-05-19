# Skill 06 — DART 공시·재무 수집

> DART 관련 모든 작업 전 이 파일을 읽어라.

---

## API 정보

```
API 키: 정호철 개인 명의 (DART 개발자 등록)
Base URL: https://opendart.fss.or.kr/api
인증: ?crtfc_key={API_KEY}
```

---

## 수집 대상

```
상장사 49개사:  재무제표 (finstate API) + 공시
비상장사 45개사: 감사보고서 XML 직접 파싱 (finstate API 미제공)

수집 주기:
  공시:       매주 일요일 06시
  분기 재무:  분기 1일 07시 (1·4·7·10월)
  감사보고서: 4월 1일 08시
```

---

## 주요 API 엔드포인트

```python
BASE = "https://opendart.fss.or.kr/api"

# 기업 코드 검색
GET {BASE}/company.json?crtfc_key={KEY}&corp_name={name}

# 공시 목록
GET {BASE}/list.json
  ?crtfc_key={KEY}
  &corp_code={code}
  &bgn_de={YYYYMMDD}
  &end_de={YYYYMMDD}
  &page_no=1
  &page_count=100

# 재무제표 (상장사만)
GET {BASE}/fnlttSinglAcntAll.json
  ?crtfc_key={KEY}
  &corp_code={code}
  &bsns_year={year}
  &reprt_code=11011  # 사업보고서
  &fs_div=CFS        # 연결재무제표

# 감사보고서 문서 (비상장사)
GET {BASE}/document.json?crtfc_key={KEY}&rcept_no={rcept_no}
  → ZIP 반환 → XML 직접 파싱
```

---

## 감사보고서 XML 파싱 (비상장사 핵심)

```python
import zipfile, io, re
from xml.etree import ElementTree as ET

def parse_audit_report_xml(zip_bytes: bytes) -> dict:
    """
    DART 감사보고서 ZIP → XML → 재무 수치 추출.
    비용 $0, 소요 6분 (45개사 일괄).
    """
    result = {}

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for name in zf.namelist():
            if not name.endswith('.xml'):
                continue
            xml_content = zf.read(name).decode('utf-8', errors='ignore')
            root = ET.fromstring(xml_content)

            # 재무 수치 추출 (실제 XML 구조 확인 후 XPath 조정)
            for item in root.findall('.//Item'):
                label = item.findtext('ItemName', '')
                value = item.findtext('Amount', '0')

                if '매출액' in label or '영업수익' in label:
                    result['revenue'] = _parse_amount(value)
                elif '영업이익' in label:
                    result['operating_income'] = _parse_amount(value)
                elif '당기순이익' in label:
                    result['net_income'] = _parse_amount(value)
                elif '자산총계' in label:
                    result['total_assets'] = _parse_amount(value)
                elif '부채총계' in label:
                    result['total_liabilities'] = _parse_amount(value)

    return result

def _parse_amount(value_str: str) -> int | None:
    """금액 문자열 → 정수 (단위: 원)"""
    try:
        return int(re.sub(r'[^\d-]', '', value_str))
    except (ValueError, TypeError):
        return None
```

---

## DB 적재 패턴

```python
def upsert_dart_financials(client, company_id: str, fiscal_year: int,
                            financials: dict, data_source: str) -> None:
    """
    dart_financials upsert.
    data_source: 'finstate_api' | 'audit_report_xml'
    """
    client.table("dart_financials").upsert({
        "company_id":         company_id,
        "fiscal_year":        fiscal_year,
        "revenue":            financials.get("revenue"),
        "operating_income":   financials.get("operating_income"),
        "net_income":         financials.get("net_income"),
        "total_assets":       financials.get("total_assets"),
        "total_liabilities":  financials.get("total_liabilities"),
        "data_source":        data_source,
    }, on_conflict="company_id,fiscal_year,data_source").execute()
```

---

## 에러 처리

```python
DART_RATE_LIMIT = 1.0  # 초당 1회 제한

async def dart_get(session, url: str, params: dict) -> dict:
    """DART API 호출 with rate limit"""
    await asyncio.sleep(DART_RATE_LIMIT)
    async with session.get(url, params=params) as resp:
        data = await resp.json()

    if data.get("status") == "010":
        raise Exception("DART API: 조회 결과 없음")
    if data.get("status") != "000":
        raise Exception(f"DART API 에러: {data.get('message')}")

    return data
```

---

## Cron 등록 (정호철 직접 등록)

```bash
# DART 주간 공시 — 매주 일요일 06시
0 6 * * 0 /Users/macmini/projects/uttu/scripts/run_dart.sh disclosures

# DART 분기 재무 — 분기 1일 07시
0 7 1 1,4,7,10 * /Users/macmini/projects/uttu/scripts/run_dart.sh financials

# DART 감사보고서 — 4월 1일 08시
0 8 1 4 * /Users/macmini/projects/uttu/scripts/run_dart.sh audit
```

---

## 주의사항

```
- API 키 개인 명의 → 법인 전환 시 재발급
- 비상장사 재무: 감사보고서 XML만 가능 (finstate API 없음)
- 연결/별도 재무: CFS(연결) 우선, 없으면 OFS(별도) 사용
- 공시 도배 주의: 자사(B.CAVE) 공시는 Slack 알림 제외
```
