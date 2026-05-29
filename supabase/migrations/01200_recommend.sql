-- 01200_recommend.sql
-- 무신사 추천판 수집
-- API: api.musinsa.com/api2/hm/web/v9/pans/recommend?storeCode=musinsa&gf={A|M|F}
-- 수집 방식: Playwright 브라우저 인터셉트 (lazy-load 대응)
-- 수집 주기: 매일 03:00, 성별 3회 (A/M/F)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

-- ── 1. 추천 모듈 (테마 큐레이션 블록) ────────────────────────────────────────

CREATE TABLE recommend_modules (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE        NOT NULL,
  gender_filter TEXT        NOT NULL DEFAULT 'A',
    -- A=전체 / M=남성 / F=여성
  module_key    TEXT        NOT NULL,
    -- API id 원본: "CAROUSEL_TWOROW-{uuid}" — 매일 새 uuid 생성됨
    -- 날짜 간 동일성 비교는 title 컬럼으로 추적
  module_type   TEXT        NOT NULL,
    -- CAROUSEL_TWOROW           : 일반 카테고리 트렌드 큐레이션
    -- CAROUSEL_TWOROW_DYNAMIC_TAB: 브랜드 탭 필터 포함 큐레이션
  title         TEXT,
    -- 에디토리얼 제목 ("지금 뜨는 스포티 스타일 카라 티셔츠 브랜드")
    -- 무신사 편집팀이 매일 바꾸는 트렌드 메시지 — 시계열 분석 핵심
  position      SMALLINT    NOT NULL,
    -- 페이지 내 등장 순서 (0-based) — 상단일수록 노출 우선순위 높음
  brand_tabs    TEXT[]      NOT NULL DEFAULT '{}',
    -- CAROUSEL_TWOROW_DYNAMIC_TAB 전용: 탭 브랜드명 배열
    -- 예: '{아디다스,나이키,"폴로 랄프 로렌"}' — 채널 전환율 분석에 활용
  items_count   SMALLINT    NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT recommend_modules_uq
    UNIQUE (snapshot_date, gender_filter, module_key)
);

CREATE INDEX recommend_modules_date_gf_idx
  ON recommend_modules(snapshot_date DESC, gender_filter);
CREATE INDEX recommend_modules_title_idx
  ON recommend_modules(title, snapshot_date DESC);
  -- "이 테마가 며칠째 노출 중인가" 집계용

COMMENT ON TABLE  recommend_modules               IS '무신사 추천판 큐레이션 블록 — 매일 스냅샷';
COMMENT ON COLUMN recommend_modules.module_key    IS 'API id 그대로 저장. uuid는 날마다 바뀌므로 날짜 간 비교는 title 사용';
COMMENT ON COLUMN recommend_modules.title         IS '편집팀 테마 제목 — 트렌드 방향성 파악 핵심 컬럼';
COMMENT ON COLUMN recommend_modules.brand_tabs    IS 'DYNAMIC_TAB 모듈의 브랜드 필터 탭 목록 (채널 전환율 계산용)';


-- ── 2. 추천 상품 ──────────────────────────────────────────────────────────────

CREATE TABLE recommend_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id     UUID        NOT NULL
                  REFERENCES recommend_modules(id) ON DELETE CASCADE,
  snapshot_date DATE        NOT NULL,
    -- JOIN 없이 날짜 필터링 가능하도록 비정규화
  gender_filter TEXT        NOT NULL DEFAULT 'A',
    -- 동일 이유로 비정규화
  musinsa_no    TEXT        NOT NULL,
    -- API item.id (상품번호) — products 테이블 조인 키
  product_id    UUID
                  REFERENCES products(id),
    -- products에 있으면 FK, 없으면 NULL (stub 생성 후 run_product.sh 가 채움)
  brand_name    TEXT        NOT NULL DEFAULT '',
  product_name  TEXT        NOT NULL DEFAULT '',
  list_price    INTEGER,
    -- 정가 (할인 전 원가) — NULL이면 무할인 정상가
  final_price   INTEGER,
    -- 실제 판매가
  discount_rate SMALLINT,
    -- 할인율 % (NULL 또는 0이면 무할인)
  review_count  INTEGER     NOT NULL DEFAULT 0,
  review_score  SMALLINT,
    -- 100점 만점 무신사 평점
  is_sold_out   BOOLEAN     NOT NULL DEFAULT false,
  position      SMALLINT    NOT NULL,
    -- 모듈 내 노출 순서 (0-based) — 상단 노출 상품 파악용
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT recommend_items_uq
    UNIQUE (module_id, musinsa_no)
);

CREATE INDEX recommend_items_date_gf_idx
  ON recommend_items(snapshot_date DESC, gender_filter);
CREATE INDEX recommend_items_brand_idx
  ON recommend_items(brand_name, snapshot_date DESC);
  -- "커버낫이 추천판에 며칠째 노출 중인가" 쿼리용
CREATE INDEX recommend_items_no_idx
  ON recommend_items(musinsa_no, snapshot_date DESC);
CREATE INDEX recommend_items_module_idx
  ON recommend_items(module_id);

COMMENT ON TABLE  recommend_items               IS '무신사 추천판 노출 상품 — recommend_modules 하위';
COMMENT ON COLUMN recommend_items.snapshot_date IS 'recommend_modules와 동일값 비정규화 — WHERE 절 JOIN 절감';
COMMENT ON COLUMN recommend_items.product_id    IS 'products 매칭 FK. 신상품은 NULL → run_product.sh 후처리';
COMMENT ON COLUMN recommend_items.review_score  IS '무신사 100점 만점 평점 (랭킹 스냅샷과 동일 체계)';

-- Rollback:
-- DROP TABLE IF EXISTS recommend_items;
-- DROP TABLE IF EXISTS recommend_modules;
