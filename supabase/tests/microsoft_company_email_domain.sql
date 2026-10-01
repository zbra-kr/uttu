-- Run in a transaction after migration 01502; only synthetic TEMP rows are used.
-- No auth.users/profiles rows are created or changed.
create temporary table uttu_domain_guard_test (
  label text,
  email text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb
) on commit drop;

create trigger uttu_domain_guard_test_before_insert
  before insert on uttu_domain_guard_test
  for each row execute function public.check_email_domain();

do $tests$
declare
  sample record;
  actual_allowed boolean;
  case_count integer := 0;
begin
  for sample in select * from (values
    ('bcave password unchanged', 'staff@bcave.co.kr'::text, '{"provider":"email"}'::jsonb, '{}'::jsonb, true),
    ('bcave azure unchanged', 'staff@bcave.co.kr', '{"provider":"azure"}', '{}', true),
    ('bcave case insensitive', 'Staff@BCAVE.CO.KR', '{"provider":"email"}', '{}', true),
    ('bcave missing app metadata unchanged', 'staff@bcave.co.kr', null, '{}', true),
    ('approved azure company', 'staff@barrelsco.onmicrosoft.com', '{"provider":"azure","providers":["azure"]}', '{}', true),
    ('approved azure case insensitive domain', 'Staff@BARRELSCO.ONMICROSOFT.COM', '{"provider":"azure"}', '{}', true),
    ('approved azure plus local part', 'staff+test@barrelsco.onmicrosoft.com', '{"provider":"azure"}', '{}', true),
    ('password cannot use exception', 'staff@barrelsco.onmicrosoft.com', '{"provider":"email"}', '{}', false),
    ('other oauth provider denied', 'staff@barrelsco.onmicrosoft.com', '{"provider":"google"}', '{}', false),
    ('missing app metadata denied', 'staff@barrelsco.onmicrosoft.com', null, '{}', false),
    ('missing provider denied', 'staff@barrelsco.onmicrosoft.com', '{}', '{}', false),
    ('providers array alone denied', 'staff@barrelsco.onmicrosoft.com', '{"providers":["azure"]}', '{}', false),
    ('user metadata spoof denied', 'staff@barrelsco.onmicrosoft.com', '{"provider":"email"}', '{"provider":"azure","iss":"https://login.microsoftonline.com/09cefcf6-a744-4cc2-a8ec-681fe0d1a85a/v2.0"}', false),
    ('provider must be exact', 'staff@barrelsco.onmicrosoft.com', '{"provider":"AZURE"}', '{}', false),
    ('null provider denied', 'staff@barrelsco.onmicrosoft.com', '{"provider":null}', '{}', false),
    ('personal Microsoft domain denied', 'staff@outlook.com', '{"provider":"azure"}', '{}', false),
    ('other Microsoft tenant domain denied', 'staff@another.onmicrosoft.com', '{"provider":"azure"}', '{}', false),
    ('ordinary external domain denied', 'staff@example.com', '{"provider":"email"}', '{}', false),
    ('suffix spoof denied', 'staff@barrelsco.onmicrosoft.com.evil.example', '{"provider":"azure"}', '{}', false),
    ('subdomain spoof denied', 'staff@evil.barrelsco.onmicrosoft.com', '{"provider":"azure"}', '{}', false),
    ('lookalike domain denied', 'staff@notbarrelsco.onmicrosoft.com', '{"provider":"azure"}', '{}', false),
    ('multiple at signs denied', 'staff@evil.example@barrelsco.onmicrosoft.com', '{"provider":"azure"}', '{}', false),
    ('empty local part denied', '@barrelsco.onmicrosoft.com', '{"provider":"azure"}', '{}', false),
    ('leading whitespace denied', ' staff@barrelsco.onmicrosoft.com', '{"provider":"azure"}', '{}', false),
    ('trailing whitespace denied', 'staff@barrelsco.onmicrosoft.com ', '{"provider":"azure"}', '{}', false),
    ('trailing newline denied', E'staff@barrelsco.onmicrosoft.com\n', '{"provider":"azure"}', '{}', false),
    ('empty email denied', '', '{"provider":"azure"}', '{}', false),
    ('null email preserves existing behavior', null, '{"provider":"email"}', '{}', true)
  ) as cases(label, email, app_metadata, user_metadata, expected_allowed)
  loop
    actual_allowed := true;
    begin
      insert into uttu_domain_guard_test (label, email, raw_app_meta_data, raw_user_meta_data)
      values (sample.label, sample.email, sample.app_metadata, sample.user_metadata);
    exception when sqlstate 'P0001' then
      actual_allowed := false;
    end;
    if actual_allowed is distinct from sample.expected_allowed then
      raise exception 'Domain guard case failed: %', sample.label using errcode = 'XX000';
    end if;
    case_count := case_count + 1;
  end loop;

  -- Existing production trigger is INSERT-only. Preserve that behavior; this
  -- migration does not add a new email-UPDATE rule or modify existing users.
  update uttu_domain_guard_test set email = 'unchanged-update-scope@example.com'
  where label = 'bcave password unchanged';
  if not exists (select 1 from uttu_domain_guard_test
                 where label = 'bcave password unchanged'
                   and email = 'unchanged-update-scope@example.com') then
    raise exception 'INSERT-only trigger behavior changed' using errcode = 'XX000';
  end if;

  raise notice 'PASS: % domain cases plus INSERT-only update-scope case', case_count;
end;
$tests$;

select 'PASS: 28 domain cases and unchanged INSERT-only update scope' as domain_guard_test_result;
