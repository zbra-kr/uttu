-- profiles에 avatar_url 컬럼 추가
alter table public.profiles add column if not exists avatar_url text;
comment on column public.profiles.avatar_url is '프로필 이미지 URL (Supabase Storage avatars 버킷)';

-- avatars 버킷 생성 (public, 최대 2MB, 이미지만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Storage RLS 정책
create policy "avatar_public_read" on storage.objects
  for select to public
  using (bucket_id = 'avatars');

create policy "avatar_own_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_own_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_own_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
