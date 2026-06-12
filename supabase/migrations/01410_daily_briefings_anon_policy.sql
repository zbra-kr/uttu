-- 01410_daily_briefings_anon_policy.sql
--
-- 목적: MCP 서버(anon 역할)가 daily_briefings를 조회할 수 있도록 정책 추가
--
-- 배경:
--   - MCP는 Bearer 토큰으로 자체 인증하며 Supabase 세션이 없음 → anon 역할로 실행
--   - 01300_daily_briefings.sql 의 기존 정책은 TO authenticated 전용
--   - 접근 제어는 MCP Bearer 토큰 레이어(/api/mcp verifyBearer)가 담당
--
-- 보안 고려:
--   - anon 키가 노출되더라도 브리핑 내용은 시장 공개 정보 기반이므로 위험도 낮음
--   - 진짜 민감 데이터(own_sales_daily, profiles 등)는 별도 RLS로 차단됨
--
-- 적용: SQL Editor 수동 실행

DROP POLICY IF EXISTS "daily_briefings_anon_select" ON daily_briefings;
CREATE POLICY "daily_briefings_anon_select"
  ON daily_briefings FOR SELECT
  TO anon USING (true);
