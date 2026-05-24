-- profiles에서 민감 컬럼(teams_webhook_url, telegram_chat_id) 제외한 공개용 view.
-- 멘션 자동완성·작성자 표시 등 다른 사용자 프로필을 읽어야 하는 용도에 사용.
-- 이 마이그레이션은 Step 2 코드 배포 전에 먼저 적용해도 안전 (단순 view 추가).

create or replace view public.profiles_public as
  select id, display_name, full_name, team, role, avatar_url
    from public.profiles;

grant select on public.profiles_public to authenticated;

comment on view public.profiles_public is
  '멘션 자동완성·작성자 표시용. profiles에서 민감 컬럼(teams_webhook_url, telegram_chat_id) 제외.';

-- 검증:
-- select * from public.profiles_public limit 5;
