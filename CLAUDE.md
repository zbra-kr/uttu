# UTTU 프로젝트 필수 지침

## 프로젝트 개요

무신사 데이터 수집 → B.CAVE 3개 부서(상품기획/재무/CS) 인텔리전스 시스템.
오너: 정호철 IT팀장 (zbra@zbra.co.kr)

---

## 스크래핑 규칙 — 절대 위반 금지

### 스텔스 (무신사가 봇임을 눈치채면 안 됨)

- **User-Agent는 반드시 실제 Chrome 브라우저 UA** — `.env`의 `SCRAPE_USER_AGENT=B.CAVE-Competitor-Radar/1.0`은 절대 사용 금지
- **모든 요청에 `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform` 포함** — Chrome 브라우저 핑거프린트 유지
- **JSON API 호출**: `sec-fetch-dest: empty`, `sec-fetch-mode: cors`, `sec-fetch-site: same-site`
- **HTML 페이지 탐색**: `sec-fetch-dest: document`, `sec-fetch-mode: navigate`, `sec-fetch-site: same-origin`, `sec-fetch-user: ?1`
- **모든 요청에 `Referer: https://www.musinsa.com/` 포함** — 무신사에서 유입된 것처럼
- `DEFAULT_HEADERS` / `PAGE_HEADERS`는 `base.py` 한 곳에서만 관리, 개별 스크래퍼에서 UA나 sec-* 헤더 임의 수정 금지

### 요청 속도

- `SCRAPE_MIN_DELAY_SEC = 3.0` 미만으로 낮추지 마 (절대 금지)
- 무신사 동시 요청 금지 — `semaphore = 1` 항상 유지
- `BotBlockedError` 발생 시 retry 금지 — 즉시 raise 후 중단

### 봇 차단 감지 신호 (`_BLOCK_SIGNALS`)

현재 등록된 신호만 사용. 임의 추가 시 정상 페이지 오탐 가능:
```python
["captcha", "비정상적", "접근이 제한", "just a moment", "enable javascript and cookies"]
```
- `"robot"` 제외 — `<meta name="robots">` 정상 HTML에 포함됨
- `"cloudflare"` 제외 — Cloudflare CDN 스크립트 참조가 정상 페이지에 포함됨

---

## 보안 규칙

- `.env`, API 키, `service_role` 키를 코드·로그·커밋에 포함 금지
- `.secret/` 폴더 `.gitignore` 누락 금지
- `service_role` 키는 worker 전용 — viewer/frontend 코드에 포함 금지
- 리뷰 닉네임·사용자ID 수집 금지 — 개인정보

---

## DB / 마이그레이션 규칙

- **마이그레이션 자동 적용 금지** — SQL 파일만 작성, 정호철이 Supabase SQL Editor에서 수동 적용
- `cron` 자동 등록 금지 — 스케줄 제안만, 정호철이 직접 등록
- Supabase 환경변수: `.env`는 `SUPABASE_SERVICE_KEY` (ROLE 없음) — 코드에서 fallback 패턴 사용:
  ```python
  service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
  ```

---

## UX / 인터랙션 제안 규칙

작업 중 아래 유형의 개선 가능성을 발견하면 구현 전에 먼저 제안한다:

- **인터랙션 디테일** — hover 확장, 키보드 단축키, 애니메이션 트랜지션 등 사용성을 높이는 동작
- **상태 지속성** — localStorage·URL 파라미터로 유지하면 편할 필터·뷰 상태
- **점진적 공개** — 접힌 패널, 드로어, 툴팁 등 정보 밀도를 높이면서 노이즈를 줄이는 패턴
- **피드백 일관성** — 로딩·에러·빈 상태 처리가 누락된 곳

제안 형식: 구현 결과물을 먼저 보여주되, 왜 이 개선이 필요한지 한 줄로 설명한다. 사용자가 OK하면 바로 적용, 아니면 넘어간다.

---

## 코드 패턴

- stub 상품: `{musinsa_no, name:"(stub)", is_own:false}` → `run_product.sh`가 상세 채움
- `detail_fetched_at IS NULL` 인 상품부터 순서대로 상세 수집
- 스크래퍼는 모두 `BaseScraper` 상속, `DEFAULT_HEADERS` / `PAGE_HEADERS` 직접 사용
