-- 00311_ai_messages_insert_policy.sql
-- ai_messages INSERT RLS — service_role 이미 바이패스하지만 사용자 JWT 경로용으로 추가
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

-- 자신의 세션에 속한 메시지를 INSERT 할 수 있도록 허용
create policy "users_insert_own_messages" on public.ai_messages
  for insert with check (
    exists (
      select 1 from public.ai_sessions s
      where s.id = session_id
        and s.user_id = auth.uid()
    )
  );

-- admin이 모든 메시지 조회 가능
create policy "admin_select_all_messages" on public.ai_messages
  for select to authenticated using (public.is_admin());

-- Rollback:
-- drop policy if exists "users_insert_own_messages" on public.ai_messages;
-- drop policy if exists "admin_select_all_messages" on public.ai_messages;
