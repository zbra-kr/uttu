-- external_news 화제성 지표 — 동일 이슈 보도 매체 수
-- Claude story_key 기반 클러스터링으로 산출
-- 적용: SQL Editor 수동 실행

ALTER TABLE external_news
  ADD COLUMN IF NOT EXISTS mention_count SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN external_news.mention_count IS
  '동일 이슈를 보도한 매체 수 — 화제성 지표 (Claude story_key 클러스터링 기반)';

CREATE INDEX IF NOT EXISTS external_news_mention_idx
  ON external_news(collected_date DESC, mention_count DESC);

-- 검증
-- SELECT mention_count, count(*) FROM external_news GROUP BY mention_count ORDER BY mention_count DESC;
