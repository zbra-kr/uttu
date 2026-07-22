-- 01411_mcp_usage_tracking.sql
--
-- 목적: MCP ask_uttu 서비스 계정 일일 LLM 토큰 사용량 추적
--
-- 배경:
--   - ask_uttu 도구는 Anthropic API를 직접 호출 → 사용자별 quota와 별도로
--     서비스 계정 단위의 일일 한도(MCP_ASK_DAILY_TOKEN_LIMIT)가 필요
--   - ai_usage_daily는 user_id(UUID FK to auth.users) 의존 → MCP 서비스 계정용 분리 테이블
--   - 단순 날짜별 집계만 필요 → FK 없이 독립 테이블로 설계
--
-- 적용: SQL Editor 수동 실행

CREATE TABLE IF NOT EXISTS mcp_usage_daily (
  usage_date    date NOT NULL,
  input_tokens  int  NOT NULL DEFAULT 0,
  output_tokens int  NOT NULL DEFAULT 0,
  call_count    int  NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_date)
);

REVOKE ALL ON mcp_usage_daily FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON mcp_usage_daily TO service_role;
