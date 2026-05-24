-- 00309_ai_sessions.sql
-- UTTU AI 대화 세션 저장 + 사용자별 토큰 사용량 관리
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

-- ── 1. 대화 세션 ─────────────────────────────────────────────────────────────
-- AiPanel 마운트 시 클라이언트가 UUID 생성 → 라우트 변경 시 새 세션
CREATE TABLE ai_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
                                -- NULL = 비인증 사용자
  route           TEXT,         -- /ranking, /anomaly 등 최초 진입 경로
  context         TEXT[],       -- context chip 배열 (e.g. ['상품 랭킹', '전체', '2026-05-24'])
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,  -- 마지막 메시지 후 서버에서 갱신
  message_count   INTEGER     NOT NULL DEFAULT 0,
  input_tokens    INTEGER     NOT NULL DEFAULT 0,   -- 세션 누적 Claude 입력 토큰
  output_tokens   INTEGER     NOT NULL DEFAULT 0,   -- 세션 누적 Claude 출력 토큰
  tool_call_count INTEGER     NOT NULL DEFAULT 0,   -- tool_use 호출 횟수 합산
  title           TEXT                              -- 첫 번째 대화 후 Claude Haiku가 자동 생성 (10자 이내)
);

CREATE INDEX ai_sessions_user_idx    ON ai_sessions(user_id, started_at DESC);
CREATE INDEX ai_sessions_route_idx   ON ai_sessions(route, started_at DESC);
CREATE INDEX ai_sessions_started_idx ON ai_sessions(started_at DESC);

COMMENT ON TABLE  ai_sessions              IS 'UTTU AI 대화 세션 — AiPanel 1회 오픈 = 1 세션';
COMMENT ON COLUMN ai_sessions.context      IS '세션 시작 시점의 context chip 배열 (분석용)';
COMMENT ON COLUMN ai_sessions.input_tokens IS 'Claude API usage.input_tokens 누적';
COMMENT ON COLUMN ai_sessions.output_tokens IS 'Claude API usage.output_tokens 누적';

-- ── 2. 메시지 ────────────────────────────────────────────────────────────────
-- 세션 내 user/assistant 턴 단위 저장
CREATE TABLE ai_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  sequence_no SMALLINT    NOT NULL,                         -- 세션 내 순번 (1부터)
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT        NOT NULL,                         -- 메시지 전체 텍스트
  tool_calls  JSONB,                                        -- [{name, label}] assistant 전용
  input_tokens  INTEGER,                                    -- assistant 전용: 해당 턴 입력 토큰
  output_tokens INTEGER,                                    -- assistant 전용: 해당 턴 출력 토큰
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_messages_session_idx ON ai_messages(session_id, sequence_no);
CREATE INDEX ai_messages_created_idx ON ai_messages(created_at DESC);

COMMENT ON TABLE  ai_messages             IS 'UTTU AI 세션 내 메시지 — user/assistant 턴';
COMMENT ON COLUMN ai_messages.tool_calls  IS 'JSON: [{name: "query_db", label: "..."}, ...]';
COMMENT ON COLUMN ai_messages.sequence_no IS '세션 내 1부터 시작하는 순번';

-- ── 3. 사용자별 토큰 제한 ────────────────────────────────────────────────────
-- 관리자가 수동으로 관리 (마이페이지 연동은 추후)
CREATE TABLE ai_user_quotas (
  user_id               UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_token_limit     INTEGER,    -- NULL = 무제한
  monthly_token_limit   INTEGER,    -- NULL = 무제한
  is_blocked            BOOLEAN     NOT NULL DEFAULT false,
                                    -- true면 AI 기능 완전 차단
  note                  TEXT,       -- 관리자 메모 (제한 사유 등)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  ai_user_quotas                   IS '사용자별 UTTU AI 토큰 제한 — 관리자 직접 관리';
COMMENT ON COLUMN ai_user_quotas.daily_token_limit IS '일별 최대 토큰 (input+output 합산), NULL=무제한';
COMMENT ON COLUMN ai_user_quotas.is_blocked        IS 'true면 어떤 토큰도 소비하지 않고 즉시 차단 응답';

-- ── 4. 일별 사용량 집계 ──────────────────────────────────────────────────────
-- quota 체크 + 분석용. API route에서 upsert로 갱신
CREATE TABLE ai_usage_daily (
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date    DATE        NOT NULL,              -- KST 기준 날짜
  input_tokens  INTEGER     NOT NULL DEFAULT 0,
  output_tokens INTEGER     NOT NULL DEFAULT 0,
  session_count INTEGER     NOT NULL DEFAULT 0,
  message_count INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT ai_usage_daily_uq UNIQUE (user_id, usage_date)
);

CREATE INDEX ai_usage_daily_user_idx ON ai_usage_daily(user_id, usage_date DESC);
CREATE INDEX ai_usage_daily_date_idx ON ai_usage_daily(usage_date DESC);

COMMENT ON TABLE ai_usage_daily IS '사용자별 일별 UTTU AI 사용량 집계 — quota 체크 + 분석용';

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- API route는 service_role 키 → RLS 바이패스. 읽기 전용 허용만 설정.

ALTER TABLE ai_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_user_quotas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_daily  ENABLE ROW LEVEL SECURITY;

-- 자신의 세션만 조회 가능
CREATE POLICY "own_sessions" ON ai_sessions
  FOR SELECT USING (auth.uid() = user_id);

-- 자신의 메시지만 조회 가능 (세션 경유)
CREATE POLICY "own_messages" ON ai_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM ai_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
  );

-- 자신의 quota만 조회 가능
CREATE POLICY "own_quota" ON ai_user_quotas
  FOR SELECT USING (auth.uid() = user_id);

-- 자신의 사용량만 조회 가능
CREATE POLICY "own_usage" ON ai_usage_daily
  FOR SELECT USING (auth.uid() = user_id);

-- Rollback:
-- DROP TABLE IF EXISTS ai_usage_daily, ai_user_quotas, ai_messages, ai_sessions;
