-- 00007_review_analysis.sql
-- LLM 리뷰 분석 결과 저장 (Ollama gemma4:e4b, 비용 $0)
-- 주기: 매주 월요일 03시
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE review_analysis (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  analysis_date         DATE        NOT NULL,           -- 분석 실행일
  low_rating_issues     TEXT[],                         -- 저점(1~2점) 리뷰 문제점 목록
  high_rating_strengths TEXT[],                         -- 고점(4~5점) 리뷰 강점 목록
  total_reviewed        INTEGER     NOT NULL DEFAULT 0, -- 분석에 사용된 리뷰 수
  low_count             INTEGER     NOT NULL DEFAULT 0, -- 저점 리뷰 수
  high_count            INTEGER     NOT NULL DEFAULT 0, -- 고점 리뷰 수
  model_used            TEXT        NOT NULL DEFAULT 'gemma4:e4b',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT review_analysis_uq UNIQUE (product_id, analysis_date)
);

CREATE INDEX review_analysis_product_idx ON review_analysis(product_id, analysis_date DESC);

COMMENT ON TABLE  review_analysis                   IS 'Ollama LLM 리뷰 분석 결과 (저점 문제점 + 고점 강점)';
COMMENT ON COLUMN review_analysis.low_rating_issues IS '저점(≤2점) 리뷰에서 추출한 문제점 배열';
COMMENT ON COLUMN review_analysis.model_used        IS 'Ollama 모델명 — 비용 $0 로컬 추론';

-- Rollback:
-- DROP TABLE IF EXISTS review_analysis;
