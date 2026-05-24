-- profiles RLS 좁히기: 다른 사용자 full row 열람 차단.
--
-- ⚠️  적용 전 필수 확인 ⚠️
-- 아래 SQL로 현재 SELECT 정책명을 확인하고, drop policy 라인을 실제 정책명에 맞게 수정 후 실행:
--
--   select policyname from pg_policies
--    where schemaname = 'public'
--      and tablename  = 'profiles'
--      and cmd        = 'SELECT';
--
-- ⚠️  적용 시점 ⚠️
-- 01000 마이그레이션 + Step 2 코드 변경이 Vercel에 배포 완료된 후에만 적용.
-- 코드 배포 전에 적용하면 멘션 자동완성·작성자 표시 기능이 즉시 깨짐.

-- 현재 풀려있는 SELECT 정책 제거 (실제 정책명을 확인 후 맞게 수정)
drop policy if exists "profiles: select any authenticated" on public.profiles;
drop policy if exists "profiles_select_authenticated"      on public.profiles;
drop policy if exists "Allow authenticated read access"    on public.profiles;
drop policy if exists "Enable read access for all users"   on public.profiles;

-- 00200에서 정의한 본인+admin 정책이 이미 있으면 중복 방지
drop policy if exists "profiles: select own or admin" on public.profiles;

-- 본인 또는 admin 만 SELECT 허용
create policy "profiles: select own or admin"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id or public.is_admin());

-- 검증 (적용 후 viewer 계정으로 실행):
-- select id, teams_webhook_url from public.profiles
--  where id <> auth.uid() limit 1;
-- → 결과 0건 (RLS 차단)
--
-- select id, display_name from public.profiles_public
--  where id <> auth.uid() limit 1;
-- → 정상 조회됨 (view 경유)
