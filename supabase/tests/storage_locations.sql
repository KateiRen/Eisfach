-- Run as postgres against a disposable database with the current schema.
begin;
insert into public.inventories(id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Locations test'),
  ('22222222-2222-4222-8222-222222222222', 'Other inventory');
insert into public.device_registrations(inventory_id, device_id, device_token_hash, device_name)
values ('11111111-1111-4111-8111-111111111111', 'location-test-device',
  extensions.digest(repeat('a', 64), 'sha256'), 'Test');
insert into public.items(id, inventory_id, name, weight_grams)
values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Fish', 500.125);
insert into public.storage_locations(id, inventory_id, name) values
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'Kitchen'),
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'Cellar'),
  ('66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 'Other');
insert into public.storage_compartments(id, inventory_id, location_id, name) values
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'Fach 1'),
  ('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555', 'Fach 1');

set local role anon;
do $$
begin
  if exists (select 1 from public.storage_locations) or exists (select 1 from public.storage_compartments) then
    raise exception 'Unauthenticated location read allowed';
  end if;
  begin
    perform public.delete_storage_location('44444444-4444-4444-8444-444444444444', null, now(), null, null);
    raise exception 'Unauthenticated deletion allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.headers',
  '{"x-inventory-id":"11111111-1111-4111-8111-111111111111","x-device-id":"location-test-device","x-device-token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);
insert into public.stock_entries(inventory_id, item_id, location_id, compartment_id, quantity) values
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
   '44444444-4444-4444-8444-444444444444', null, 2),
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
   '44444444-4444-4444-8444-444444444444', '77777777-7777-4777-8777-777777777777', 0);

do $$
declare
  version timestamptz;
  moved integer;
begin
  if (select count(*) from public.storage_locations) <> 2 then
    raise exception 'Other inventory locations visible';
  end if;
  begin
    insert into public.storage_locations(inventory_id, name)
    values ('22222222-2222-4222-8222-222222222222', 'Unauthorized');
    raise exception 'Cross-inventory location write allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.stock_entries(inventory_id, item_id, location_id, compartment_id)
    values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444', '88888888-8888-4888-8888-888888888888');
    raise exception 'Compartment from another location accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.stock_entries(inventory_id, item_id, location_id)
    values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
      '66666666-6666-4666-8666-666666666666');
    raise exception 'Location from another inventory accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    delete from public.storage_locations where id = '44444444-4444-4444-8444-444444444444';
    raise exception 'Occupied location deletion lost stock';
  exception when foreign_key_violation then null;
  end;
  select updated_at into version from public.storage_locations
    where id = '44444444-4444-4444-8444-444444444444';
  -- Catch only the expected RPC error, not the regression assertion.
  begin
    perform public.delete_storage_location(
      '44444444-4444-4444-8444-444444444444', null, version, null, null);
    raise exception 'Missing replacement accepted' using errcode = 'XX000';
  exception when raise_exception then null;
  end;
  begin
    perform public.delete_storage_location('44444444-4444-4444-8444-444444444444', null,
      version, '66666666-6666-4666-8666-666666666666', null);
    raise exception 'Foreign replacement accepted' using errcode = 'XX000';
  exception when raise_exception then null;
  end;
  begin
    perform public.delete_storage_location('44444444-4444-4444-8444-444444444444', null,
      version - interval '1 minute', '55555555-5555-4555-8555-555555555555', null);
    raise exception 'Stale deletion accepted' using errcode = 'XX000';
  exception when raise_exception then null;
  end;
  update public.storage_locations set name = 'Fridge'
    where id = '44444444-4444-4444-8444-444444444444';
  if (select count(*) from public.stock_entries
      where location_id = '44444444-4444-4444-8444-444444444444') <> 2 then
    raise exception 'Rename changed stock assignment';
  end if;
  select updated_at into version from public.storage_compartments
    where id = '77777777-7777-4777-8777-777777777777';
  moved := public.delete_storage_location(
    '44444444-4444-4444-8444-444444444444', '77777777-7777-4777-8777-777777777777',
    version, '44444444-4444-4444-8444-444444444444', null);
  if moved <> 1 or exists (select 1 from public.stock_entries where compartment_id is not null) then
    raise exception 'Compartment deletion did not relocate to parent without compartment';
  end if;
  select updated_at into version from public.storage_locations
    where id = '44444444-4444-4444-8444-444444444444';
  moved := public.delete_storage_location('44444444-4444-4444-8444-444444444444', null,
    version, '55555555-5555-4555-8555-555555555555', '88888888-8888-4888-8888-888888888888');
  if moved <> 2 or (select count(*) from public.stock_entries
      where location_id = '55555555-5555-4555-8555-555555555555'
        and compartment_id = '88888888-8888-4888-8888-888888888888') <> 2 then
    raise exception 'Location deletion did not relocate every position';
  end if;
  if (select sum(quantity) from public.stock_entries) <> 2
    or (select weight_grams from public.items where id = '33333333-3333-4333-8333-333333333333') <> 500.125 then
    raise exception 'Relocation changed quantity or product weight';
  end if;
  if exists (select 1 from public.storage_locations where id = '44444444-4444-4444-8444-444444444444') then
    raise exception 'Source location still exists';
  end if;
end;
$$;
rollback;
