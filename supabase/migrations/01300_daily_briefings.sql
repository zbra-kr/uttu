-- 데일리 브리핑 — 페르소나별 매거진 LLM 사전 생성 결과 저장
-- 매일 06:00 worker/agent/briefing_writer.py 가 audience 3종 생성 후 upsert
-- 적용 순서: 01300 → 01301 → 01302

CREATE TABLE IF NOT EXISTS daily_briefings (
  briefing_date     DATE        NOT NULL,
  audience          TEXT        NOT NULL CHECK (audience IN ('executive', 'staff', 'cs')),

  -- 헤드라인·리드
  headline          TEXT        NOT NULL,
  daily_brief       TEXT[]      NOT NULL,   -- 어제의 핵심 3줄
  weekly_brief      TEXT[],                 -- 금주의 핵심 (executive·staff)

  -- 카드 코멘트 — audience별 키 다름, 부록 B 참조
  card_comments     JSONB       NOT NULL,

  -- 인사이트 N선 — [{title, body, link}]
  -- executive: 3개 / staff: 5개 / cs: 3개
  insights          JSONB       NOT NULL,

  -- 외부 뉴스 (executive audience 전용)
  -- [{headline, summary, source_name, source_url, relevance}]
  news_picks        JSONB,

  -- 생성 메타
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  model             TEXT        NOT NULL,   -- "claude-sonnet-4-6" 등
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  generation_ms     INTEGER,               -- 생성 소요 시간 ms

  PRIMARY KEY (briefing_date, audience)
);

CREATE INDEX IF NOT EXISTS daily_briefings_date_idx
  ON daily_briefings(briefing_date DESC);

COMMENT ON TABLE  daily_briefings IS '페르소나별 데일리 매거진 — 매일 1회 사전 생성 (worker/agent/briefing_writer.py)';
COMMENT ON COLUMN daily_briefings.audience      IS 'executive: 경영진 / staff: 일반 임직원 / cs: CS팀';
COMMENT ON COLUMN daily_briefings.card_comments IS '카드별 1줄 LLM 코멘트 JSONB';
COMMENT ON COLUMN daily_briefings.insights      IS '인사이트 N선 [{title, body, link}]';
COMMENT ON COLUMN daily_briefings.news_picks    IS '외부 패션 뉴스 — executive audience 전용';

-- RLS: 인증된 사용자 모두 SELECT, 쓰기는 service_role만
ALTER TABLE daily_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_briefings_select"
  ON daily_briefings FOR SELECT
  TO authenticated USING (true);

-- 검증 쿼리
-- SELECT count(*) FROM daily_briefings;   -- 0 기대
-- SELECT * FROM daily_briefings LIMIT 1;
