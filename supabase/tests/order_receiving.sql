-- Run as postgres against a disposable database initialized with schema.sql.
begin;

insert into public.inventories(id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Receiving test'),
  ('22222222-2222-4222-8222-222222222222', 'Other inventory');
insert into public.device_registrations(inventory_id, device_id, device_token_hash, device_name)
values ('11111111-1111-4111-8111-111111111111', 'receiving-device',
  extensions.digest(repeat('a', 64), 'sha256'), 'Test');
insert into public.items(id, inventory_id, name) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Fish'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'Other');
insert into public.storage_locations(id, inventory_id, name) values
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'Cellar'),
  ('66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 'Other');
insert into public.order_entries(id, inventory_id, item_id, quantity) values
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333', 3);

set local role anon;
do $$
begin
  begin
    perform public.receive_order(
      '77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333', now(),
      gen_random_uuid(), '55555555-5555-4555-8555-555555555555', null, 1);
    raise exception 'Unauthenticated receiving accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.headers',
  '{"x-inventory-id":"11111111-1111-4111-8111-111111111111","x-device-id":"receiving-device","x-device-token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);

do $$
declare
  order_id uuid := '77777777-7777-4777-8777-777777777777';
  item_id uuid := '33333333-3333-4333-8333-333333333333';
  location_id uuid := '55555555-5555-4555-8555-555555555555';
  position_id uuid := gen_random_uuid();
  final_position_id uuid := gen_random_uuid();
  version timestamptz;
  invalid_quantity integer;
begin
  select updated_at into version from public.order_entries where id = order_id;
  begin
    perform public.receive_order(order_id, item_id, version - interval '1 second',
      position_id, location_id, null, 1);
    raise exception 'Stale order accepted';
  exception when raise_exception then
    if sqlerrm = 'Stale order accepted' then raise; end if;
  end;
  foreach invalid_quantity in array array[0, -1, 4, null] loop
    begin
      perform public.receive_order(order_id, item_id, version,
        position_id, location_id, null, invalid_quantity);
      raise exception 'Invalid receiving quantity accepted';
    exception when check_violation then null;
    end;
  end loop;
  begin
    perform public.receive_order(order_id, item_id, version,
      position_id, '66666666-6666-4666-8666-666666666666', null, 1);
    raise exception 'Foreign storage accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.receive_order(order_id, '44444444-4444-4444-8444-444444444444', version,
      position_id, location_id, null, 1);
    raise exception 'Foreign product accepted';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.stock_entries)
    or (select quantity from public.order_entries where id = order_id) <> 3 then
    raise exception 'Failed receiving left changes behind';
  end if;

  perform public.receive_order(order_id, item_id, version, position_id, location_id, null, 2);
  perform public.receive_order(order_id, item_id, version, position_id, location_id, null, 2);
  if (select quantity from public.order_entries where id = order_id) <> 1
    or (select count(*) from public.stock_entries) <> 1
    or (select quantity from public.stock_entries where id = position_id) <> 2
    or (select usage_count from public.items where id = item_id) <> 1 then
    raise exception 'Partial receiving or retry changed incorrect quantities';
  end if;
  begin
    perform public.receive_order(order_id, item_id, version, position_id, location_id, null, 1);
    raise exception 'Changed retry accepted';
  exception when raise_exception then
    if sqlerrm = 'Changed retry accepted' then raise; end if;
  end;

  select updated_at into version from public.order_entries where id = order_id;
  perform public.receive_order(order_id, item_id, version, final_position_id, location_id, null, 1);
  perform public.receive_order(order_id, item_id, version, final_position_id, location_id, null, 1);
  if exists (select 1 from public.order_entries where id = order_id)
    or (select count(*) from public.stock_entries) <> 2
    or (select usage_count from public.items where id = item_id) <> 2 then
    raise exception 'Full receiving or retry did not remove exactly the remaining order';
  end if;

  insert into public.order_entries(id, inventory_id, item_id, quantity)
    values (order_id, '11111111-1111-4111-8111-111111111111', item_id, 2);
  update public.items set usage_count = 2147483647 where id = item_id;
  select updated_at into version from public.order_entries where id = order_id;
  begin
    perform public.receive_order(order_id, item_id, version, gen_random_uuid(), location_id, null, 1);
    raise exception 'Counter overflow accepted';
  exception when numeric_value_out_of_range then null;
  end;
  if (select count(*) from public.stock_entries) <> 2
    or (select quantity from public.order_entries where id = order_id) <> 2 then
    raise exception 'Counter overflow left partial receiving changes';
  end if;
end;
$$;

rollback;
