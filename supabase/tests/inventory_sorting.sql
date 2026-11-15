-- Run as postgres against a disposable database with the current schema.
begin;
insert into public.inventories(id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Sorting test'),
  ('22222222-2222-4222-8222-222222222222', 'Other inventory');
insert into public.device_registrations(inventory_id, device_id, device_token_hash, device_name)
values ('11111111-1111-4111-8111-111111111111', 'sorting-test-device',
  extensions.digest(repeat('a', 64), 'sha256'), 'Test');
insert into public.inventory_sorting(inventory_id, categories) values
  ('22222222-2222-4222-8222-222222222222', array['Other']);

set local role anon;
do $$
begin
  if exists (select 1 from public.inventory_sorting) then
    raise exception 'Unauthenticated sorting read allowed';
  end if;
  begin
    insert into public.inventory_sorting(inventory_id)
    values ('11111111-1111-4111-8111-111111111111');
    raise exception 'Unauthenticated sorting write allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.headers',
  '{"x-inventory-id":"11111111-1111-4111-8111-111111111111","x-device-id":"sorting-test-device","x-device-token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);

do $$
declare
  changed integer;
begin
  if exists (select 1 from public.inventory_sorting) then
    raise exception 'Other inventory sorting visible';
  end if;
  insert into public.inventory_sorting(inventory_id, categories)
  values ('11111111-1111-4111-8111-111111111111', array['Fisch', '', 'Gemüse']);
  update public.inventory_sorting set categories = array['Gemüse', 'Fisch', '']
    where inventory_id = '11111111-1111-4111-8111-111111111111';
  if (select categories from public.inventory_sorting) <> array['Gemüse', 'Fisch', ''] then
    raise exception 'Sorting update was not stored';
  end if;
  update public.inventory_sorting set categories = array['Overwrite']
    where updated_at = '2000-01-01'::timestamptz;
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'Stale sorting update accepted';
  end if;
  begin
    insert into public.inventory_sorting(inventory_id)
    values ('22222222-2222-4222-8222-222222222222');
    raise exception 'Cross-inventory sorting insert allowed';
  exception when insufficient_privilege then null;
  end;
  update public.inventory_sorting set categories = array['Overwrite']
    where inventory_id = '22222222-2222-4222-8222-222222222222';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'Cross-inventory sorting update allowed';
  end if;
  begin
    update public.inventory_sorting set categories = array['Fisch', null];
    raise exception 'Null category accepted';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
