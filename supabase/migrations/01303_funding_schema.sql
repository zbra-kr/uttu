-- 01303_funding_schema.sql
-- 투자유치/자금조달 이력 수집 스키마 (on-demand)
-- 출처: DART estkRs(증권신고서 지분증권) + DART piicDecsn(유상증자결정) + 뉴스 NLP
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)
-- 적용 순서: 01303 단독 적용 (기존 companies, collection_jobs 테이블 존재 가정)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. funding_rounds
--    source_type 별 원천 필드 매핑:
--      dart_estkrs  : rcept_no(source_ref), slta(amount_krw), actnmn(investors),
--                     pymd(announced_date), stksen/slmthn(round_type 보조)
--      dart_piic    : rcept_no(source_ref), fdpp_op+fdpp_fclt+fdpp_bsninh 합산(amount_krw),
--                     ic_mthn(round_type 보조), ssl_bgd/ssl_edd(날짜 보조)
--      news         : 뉴스 URL(source_ref), Ollama 추출 (amount_krw, investors, announced_date)
--      datago_crowd : getFundIssuCompInfo — DATA_GO_KR_SERVICE_KEY 미발급 시 skip
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS funding_rounds (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- 라운드 분류
  round_type      TEXT,
  -- 허용 값 가이드 (제약 없음 — 뉴스 추출값 자유 텍스트 허용):
  --   seed / pre-A / series-A / series-B / series-C / 유상증자 / IPO / 크라우드펀딩 / 기타

  -- 금액: 원 단위 정규화. 불명 시 NULL
  amount_krw      BIGINT,

  announced_date  DATE,
  investors       TEXT[]      DEFAULT '{}',

  -- 원천 식별
  source_type     TEXT        NOT NULL,
  -- dart_estkrs   : DART 증권신고서 지분증권 (estkRs.json)
  -- dart_piic     : DART 주요사항보고서 유상증자결정 (piicDecsn.json)
  -- datago_fund   : data.go.kr 자금조달공시정보 (GetFundInfoService)
  -- datago_crowd  : data.go.kr 크라우드펀딩정보 (getFundIssuCompInfo)
  -- datago_stock  : data.go.kr 주식발행정보 (GetStockIssuInfoService)
  -- news          : 뉴스 NLP 추출 (Ollama gemma4:e4b)

  source_url      TEXT,
  source_ref      TEXT,
  -- dart_estkrs/dart_piic: rcept_no (DART 접수번호 14자리)
  -- datago_*: API 제공 고유 식별자
  -- news: 기사 URL

  confidence      NUMERIC(3, 2),
  -- 1.00 = 공시(확실) / 0.00~0.99 = 뉴스 NLP 신뢰도

  -- 원본 페이로드 (DART group 배열 또는 list 배열 전체 보존)
  raw             JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 동일 원천 중복 방지
  UNIQUE (company_id, source_type, source_ref)
);

CREATE INDEX IF NOT EXISTS funding_company_idx
  ON funding_rounds(company_id, announced_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS funding_source_idx
  ON funding_rounds(source_type);

CREATE INDEX IF NOT EXISTS funding_date_idx
  ON funding_rounds(announced_date DESC NULLS LAST)
  WHERE announced_date IS NOT NULL;

COMMENT ON TABLE  funding_rounds IS '투자유치/자금조달 이력 — on-demand 수집 (DART + 뉴스 NLP)';
COMMENT ON COLUMN funding_rounds.source_type   IS 'dart_estkrs|dart_piic|datago_fund|datago_crowd|datago_stock|news';
COMMENT ON COLUMN funding_rounds.source_ref    IS 'DART 접수번호(rcept_no) 또는 기사URL — 중복 방지 키';
COMMENT ON COLUMN funding_rounds.confidence    IS '1.00=공시 확실, <1.00=뉴스 NLP 신뢰도';
COMMENT ON COLUMN funding_rounds.amount_krw    IS '조달 금액 (원 단위 정규화). NULL=불명';
COMMENT ON COLUMN funding_rounds.raw           IS 'DART API 원본 페이로드 또는 뉴스 원문 보존';

-- RLS
ALTER TABLE funding_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "funding_rounds_select"
  ON funding_rounds FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "funding_rounds_select_anon"
  ON funding_rounds FOR SELECT
  TO anon USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. companies 캐시 컬럼 — 마지막 투자정보 수집 시각
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS funding_last_collected_at TIMESTAMPTZ;

COMMENT ON COLUMN companies.funding_last_collected_at
  IS '마지막 투자정보 수집 시각. NULL=미수집. 7일 이내면 재수집 안 함(캐시).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. funding_collection_jobs
--    기존 collection_jobs는 배치 스크래퍼 전용 (script/label 기반, pending 상태 없음).
--    on-demand per-company 잡 패턴에 맞지 않으므로 별도 테이블 생성.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS funding_collection_jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'done', 'failed')),
  requested_by  TEXT,       -- 요청자 (anon IP or user_id)
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  rounds_found  INTEGER     NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funding_jobs_status_idx
  ON funding_collection_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS funding_jobs_company_idx
  ON funding_collection_jobs(company_id, created_at DESC);

COMMENT ON TABLE  funding_collection_jobs IS '투자정보 on-demand 수집 잡 — Viewer [투자정보 수집] 버튼 → Realtime 구독';
COMMENT ON COLUMN funding_collection_jobs.status       IS 'pending|running|done|failed';
COMMENT ON COLUMN funding_collection_jobs.rounds_found IS '수집 완료된 라운드 수';
COMMENT ON COLUMN funding_collection_jobs.requested_by IS '요청자 식별자 (optional)';

-- Realtime 활성화 (Supabase 대시보드에서 정호철 직접 활성화 필요)
ALTER PUBLICATION supabase_realtime ADD TABLE funding_collection_jobs;

-- RLS: anon INSERT (Viewer가 잡 생성), anon/authenticated SELECT
ALTER TABLE funding_collection_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "funding_jobs_insert_anon"
  ON funding_collection_jobs FOR INSERT
  TO anon WITH CHECK (true);

CREATE POLICY "funding_jobs_select_anon"
  ON funding_collection_jobs FOR SELECT
  TO anon USING (true);

CREATE POLICY "funding_jobs_select_auth"
  ON funding_collection_jobs FOR SELECT
  TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback:
-- DROP TABLE IF EXISTS funding_collection_jobs;
-- ALTER TABLE companies DROP COLUMN IF EXISTS funding_last_collected_at;
-- DROP TABLE IF EXISTS funding_rounds;
-- (Realtime 비활성화: Supabase 대시보드에서 직접)
-- ─────────────────────────────────────────────────────────────────────────────
