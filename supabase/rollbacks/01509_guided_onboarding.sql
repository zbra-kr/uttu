-- LOCAL REVIEW ONLY. Disable the tour UI before applying this rollback.
-- Back up onboarding progress and the original release cutoff first. Removing
-- them loses completion/skip history. Reinstalling without restoring the same
-- cutoff would classify accounts created since the original rollout as legacy.
-- No CASCADE: unexpected dependencies abort the entire rollback safely.
begin;
drop function if exists public.save_my_onboarding(text, integer, boolean);
drop function if exists public.get_my_onboarding();
drop table if exists public.user_onboarding;
drop table if exists public.onboarding_releases;
commit;
