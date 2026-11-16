-- Run as postgres against a disposable database initialized with schema.sql.
begin;

insert into public.inventories(id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Orders test'),
  ('22222222-2222-4222-8222-222222222222', 'Other inventory');
insert into public.device_registrations(inventory_id, device_id, device_token_hash, device_name)
values ('11111111-1111-4111-8111-111111111111', 'orders-device',
  extensions.digest(repeat('a', 64), 'sha256'), 'Test');
insert into public.items(id, inventory_id, name) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Fish'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'Other');
insert into public.order_entries(inventory_id, item_id, quantity)
values ('22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', 7);

set local role anon;
do $$
begin
  if exists (select 1 from public.order_entries) then
    raise exception 'Unauthenticated order read accepted';
  end if;
  begin
    perform public.reorder_product('33333333-3333-4333-8333-333333333333');
    raise exception 'Unauthenticated reorder accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.headers',
  '{"x-inventory-id":"11111111-1111-4111-8111-111111111111","x-device-id":"orders-device","x-device-token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);

select public.reorder_product('33333333-3333-4333-8333-333333333333');
select public.reorder_product('33333333-3333-4333-8333-333333333333');

do $$
begin
  if (select count(*) from public.order_entries) <> 1
    or (select quantity from public.order_entries) <> 2 then
    raise exception 'Reorder must create one row and increment its quantity';
  end if;
  if exists (select 1 from public.stock_entries)
    or (select usage_count from public.items where id = '33333333-3333-4333-8333-333333333333') <> 0 then
    raise exception 'Reorder changed stock or usage';
  end if;
  if (select price from public.items where id = '33333333-3333-4333-8333-333333333333') is not null then
    raise exception 'Price must default to null';
  end if;
  update public.items set price = 0 where id = '33333333-3333-4333-8333-333333333333';
  update public.items set price = 4.99 where id = '33333333-3333-4333-8333-333333333333';
  if (select price from public.items where id = '33333333-3333-4333-8333-333333333333') <> 4.99 then
    raise exception 'Price was not retained';
  end if;
  begin
    update public.items set price = -1 where id = '33333333-3333-4333-8333-333333333333';
    raise exception 'Negative price accepted';
  exception when check_violation then null;
  end;
  begin
    update public.items set price = 100000000 where id = '33333333-3333-4333-8333-333333333333';
    raise exception 'Price overflow accepted';
  exception when numeric_value_out_of_range then null;
  end;
  begin
    perform public.reorder_product('44444444-4444-4444-8444-444444444444');
    raise exception 'Foreign product accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.order_entries(inventory_id, item_id)
    values ('22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444');
    raise exception 'Foreign inventory write accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.order_entries(inventory_id, item_id)
    values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444');
    raise exception 'Cross-inventory product reference accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.order_entries(inventory_id, item_id)
    values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
    raise exception 'Duplicate order accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.order_entries set quantity = 0;
    raise exception 'Zero quantity accepted';
  exception when check_violation then null;
  end;
  update public.order_entries set quantity = 2147483647;
  begin
    perform public.reorder_product('33333333-3333-4333-8333-333333333333');
    raise exception 'Quantity overflow accepted';
  exception when numeric_value_out_of_range then null;
  end;
  if (select quantity from public.order_entries) <> 2147483647 then
    raise exception 'Overflow changed quantity';
  end if;
end;
$$;

update public.order_entries set quantity = 3;
delete from public.order_entries;
select public.reorder_product('33333333-3333-4333-8333-333333333333');
delete from public.items where id = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if exists (select 1 from public.order_entries) then
    raise exception 'Product deletion left an order entry behind';
  end if;
end;
$$;
reset role;
do $$
begin
  if (select count(*) from public.order_entries) <> 1
    or (select quantity from public.order_entries) <> 7 then
    raise exception 'Foreign order was changed';
  end if;
end;
$$;

rollback;
