-- 00313_ai_sessions_model_cols.sql
-- ai_sessions 에 ai_provider / ai_model 컬럼 추가
-- profiles 에 preferred_model 컬럼 추가 (Phase 1.5B: 사용자별 선호 모델)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

-- ai_sessions: 어떤 provider / 모델로 응답했는지 기록
alter table public.ai_sessions
  add column if not exists ai_provider text,   -- 'anthropic' | 'openai' | 'google'
  add column if not exists ai_model    text;   -- 실제 사용된 model_id

comment on column public.ai_sessions.ai_provider is '응답 생성에 사용된 LLM provider';
comment on column public.ai_sessions.ai_model    is '응답 생성에 사용된 model_id (ai_allowed_models.model_id)';

-- profiles: 사용자가 선택한 선호 모델 (NULL = 시스템 기본값 사용)
alter table public.profiles
  add column if not exists preferred_model text references public.ai_allowed_models(model_id) on delete set null;

comment on column public.profiles.preferred_model is 'UTTU AI 선호 모델 (NULL = 시스템 기본값)';

-- Rollback:
-- alter table public.ai_sessions drop column if exists ai_provider, drop column if exists ai_model;
-- alter table public.profiles    drop column if exists preferred_model;
