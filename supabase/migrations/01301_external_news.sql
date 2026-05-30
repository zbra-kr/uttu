-- 외부 패션 뉴스 — 매일 web_search로 수집 후 LLM 요약·분류
-- 매일 05:30 worker/agent/news_collector.py 실행
-- 적용 순서: 01300 → 01301 → 01302

CREATE TABLE IF NOT EXISTS external_news (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  collected_date    DATE        NOT NULL,
  category          TEXT        NOT NULL CHECK (category IN
                      ('industry', 'own_brand', 'competitor', 'trend', 'platform')),
                    -- industry:   패션 산업 일반
                    -- own_brand:  자사 브랜드(커버낫·리·와키윌리) 직접 언급
                    -- competitor: 경쟁사 직접 언급
                    -- trend:      K-패션 트렌드 일반
                    -- platform:   무신사·SSF·29CM 등 플랫폼

  headline          TEXT        NOT NULL,
  summary           TEXT,                   -- LLM 요약 (3~5줄)
  source_url        TEXT,
  source_name       TEXT,                   -- "한국경제", "WWD Korea" 등
  relevance         SMALLINT    NOT NULL CHECK (relevance BETWEEN 1 AND 5),
                    -- 5: 자사 직접 언급 / 4: 경쟁사 직접 / 3: 산업 영향
                    -- 2: 트렌드 / 1: 일반

  related_brands    TEXT[],                 -- 언급된 자사·경쟁사 brand slug
  related_companies TEXT[],                 -- 언급된 회사명

  published_at      TIMESTAMPTZ,
  collected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (source_url)
);

CREATE INDEX IF NOT EXISTS external_news_date_idx
  ON external_news(collected_date DESC);

CREATE INDEX IF NOT EXISTS external_news_relevance_idx
  ON external_news(collected_date DESC, relevance DESC);

CREATE INDEX IF NOT EXISTS external_news_category_idx
  ON external_news(category, collected_date DESC);

COMMENT ON TABLE  external_news IS '외부 패션 뉴스 — 매일 web_search 수집 + LLM 요약 (worker/agent/news_collector.py)';
COMMENT ON COLUMN external_news.relevance IS '1~5 (자사 영향도): 5=자사 직접 언급, 1=일반';
COMMENT ON COLUMN external_news.category  IS 'industry|own_brand|competitor|trend|platform';

ALTER TABLE external_news ENABLE ROW LEVEL SECURITY;

CREATE POLICY "external_news_select"
  ON external_news FOR SELECT
  TO authenticated USING (true);

-- 검증 쿼리
-- SELECT count(*) FROM external_news;   -- 0 기대
