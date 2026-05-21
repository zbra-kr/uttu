# UTTU — 개발 TODO

> 우선순위: 🔴 긴급 / 🟡 중요 / 🟢 나중에

---

## 🟡 DART 관련

### corp_code 수동 등록 기능
- **배경**: DART 이름 매칭 실패 케이스 (사업자번호 불일치, DART 미등록명)
  - 에프앤에프: DB bizr_no(1538102451) ≠ DART bizr_no(5408602835) — 판매처 vs 법인 불일치
  - 영원아웃도어: DART corp list에 해당 이름 없음 (영원무역 자회사 추정)
- **필요 기능**:
  - Viewer 관리 화면 또는 스크립트로 `companies.corp_code` 직접 수정
  - DART 사이트(dart.fss.or.kr)에서 corp_code 확인 후 UPDATE
  - 예시 SQL:
    ```sql
    -- 에프앤에프: DART에서 corp_code 확인 후
    UPDATE companies SET corp_code = '00000000', is_listed = true
    WHERE business_number = '1538102451';
    ```
- **확인 필요 회사**: 에프앤에프, 영원아웃도어, (무신사는 corp_code 있으나 DART 공시 없음)

### DART 수집 정기화
- corp_code 확보된 회사의 공시·재무 주기적 수집 cron 등록 (정호철 직접)
  ```
  # 공시 — 매주 일요일 06시
  0 6 * * 0 .venv/bin/python3 -m worker.scrapers.dart_scraper --target all --years 1
  ```

---

## 🟡 수집 관련

### 브랜드 상세 수집 완료 확인
- 현재 3,291 / 4,467개 완료 (수집 중)
- 완료 후 나머지 재시도 필요한지 확인

### 리뷰 분석 (LLM)
- `review_analysis` 테이블 비어있음
- Ollama (gemma4:e4b) 로컬 모델로 리뷰 요약·감성분석 개발 필요

### Snowflake 연동
- `own_sales_daily`, `own_inventory` 수집 미개발
- Snowflake read-only Key-pair 인증 연동 필요

---

## 🟢 Viewer 관련

### 재무 데이터 뷰 추가
- `dart_financials` 수집됐으나 Viewer에 표시 안 됨
- 재무팀용 경쟁사 재무 비교 화면 필요

---

## 완료된 항목 ✅

- [x] 무신사 랭킹 스크래퍼 (27조합, 매일)
- [x] 브랜드 랭킹 스크래퍼
- [x] 상품 상세 스크래퍼 (자사 + 경쟁사 TOP50)
- [x] 브랜드 상세 스크래퍼
- [x] 프로모션 스크래퍼
- [x] 자사 리뷰 스크래퍼
- [x] 스냅 스크래퍼
- [x] 매거진 스크래퍼
- [x] skip-detail 정책 적용 (111,081개 제외)
- [x] Teams + Telegram 알림 시스템
- [x] DART 스크래퍼 초기 버전 (B.CAVE 5개년, 더네이쳐홀딩스 3개년)
