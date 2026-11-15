-- Run as postgres against a disposable database after schema.sql or the migration.
begin;

insert into public.inventories(id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Stock test'),
  ('22222222-2222-4222-8222-222222222222', 'Other inventory');
insert into public.device_registrations(inventory_id, device_id, device_token_hash, device_name)
values (
  '11111111-1111-4111-8111-111111111111',
  'stock-test-device', extensions.digest(repeat('a', 64), 'sha256'), 'Test'
);
insert into public.items(id, inventory_id, name, preparation_minutes, thawing_minutes) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Fish', 20, 0),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'Other', null, null);

do $$
begin
  begin
    insert into public.stock_entries(inventory_id, item_id)
    values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444');
    raise exception 'Cross-inventory product reference accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.stock_entries(inventory_id, item_id, weight_grams)
    values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', -1);
    raise exception 'Negative weight accepted';
  exception when check_violation then null;
  end;
  begin
    update public.items set thawing_minutes = -1 where id = '33333333-3333-4333-8333-333333333333';
    raise exception 'Negative thawing time accepted';
  exception when check_violation then null;
  end;
end;
$$;

set local role anon;
do $$
begin
  if exists (select 1 from public.stock_entries) or exists (select 1 from public.items) then
    raise exception 'Unauthenticated read allowed';
  end if;
  begin
    insert into public.stock_entries(inventory_id, item_id)
    values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
    raise exception 'Unauthenticated write allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.headers',
  '{"x-inventory-id":"11111111-1111-4111-8111-111111111111","x-device-id":"stock-test-device","x-device-token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);
insert into public.stock_entries(inventory_id, item_id, location, quantity, weight_grams) values
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'Cellar', 2, 500.125),
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'Kitchen', 1, null),
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'Cellar', 0, 250);
do $$
begin
  if (select count(*) from public.stock_entries where item_id = '33333333-3333-4333-8333-333333333333') <> 3 then
    raise exception 'Multiple positions not preserved';
  end if;
  if exists (select 1 from public.items where id = '44444444-4444-4444-8444-444444444444') then
    raise exception 'Other inventory product visible';
  end if;
  begin
    insert into public.stock_entries(inventory_id, item_id)
    values ('22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444');
    raise exception 'Other inventory stock writable';
  exception when insufficient_privilege then null;
  end;
end;
$$;
update public.stock_entries set quantity = 3 where weight_grams = 500.125;
do $$
begin
  if not exists (select 1 from public.stock_entries where quantity = 3 and weight_grams = 500.125) then
    raise exception 'Quantity change modified total weight';
  end if;
end;
$$;
delete from public.stock_entries where item_id = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if not exists (select 1 from public.items where id = '33333333-3333-4333-8333-333333333333' and preparation_minutes = 20 and thawing_minutes = 0) then
    raise exception 'Removing stock lost product data';
  end if;
end;
$$;
insert into public.stock_entries(inventory_id, item_id, quantity)
values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 1);
delete from public.items where id = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if exists (select 1 from public.stock_entries where item_id = '33333333-3333-4333-8333-333333333333') then
    raise exception 'Product deletion did not remove stock';
  end if;
  if (select count(*) from public.audit_log where action = 'stock.delete' and item_id = '33333333-3333-4333-8333-333333333333') <> 4 then
    raise exception 'Stock deletions not audited';
  end if;
end;
$$;

rollback;
