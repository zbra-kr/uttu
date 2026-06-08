-- external_news 사건 본질 중요도 컬럼 추가
-- relevance(자사 영향도)와 별개로 사건 자체의 무게를 저장
-- 적용: SQL Editor 수동 실행

ALTER TABLE external_news
  ADD COLUMN IF NOT EXISTS importance SMALLINT NOT NULL DEFAULT 2;

COMMENT ON COLUMN external_news.importance IS
  '사건 본질 중요도 (1=NOISE~5=CRITICAL). relevance(자사영향도)와 독립 지표.';

CREATE INDEX IF NOT EXISTS external_news_importance_idx
  ON external_news(collected_date DESC, importance DESC, relevance DESC);

-- 검증
-- SELECT importance, count(*) FROM external_news GROUP BY importance ORDER BY importance DESC;
