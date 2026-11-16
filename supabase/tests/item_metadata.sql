-- Run as postgres against a disposable database initialized with schema.sql.
begin;

insert into public.inventories(id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Metadata test'),
  ('22222222-2222-4222-8222-222222222222', 'Other inventory');
insert into public.device_registrations(inventory_id, device_id, device_token_hash, device_name)
values ('11111111-1111-4111-8111-111111111111', 'metadata-device',
  extensions.digest(repeat('a', 64), 'sha256'), 'Test');
insert into public.items(id, inventory_id, name) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Fish'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'Other');
insert into public.storage_locations(id, inventory_id, name) values
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'Cellar'),
  ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'Kitchen');

set local role anon;
do $$
begin
  begin
    perform public.create_stock_position(gen_random_uuid(), '33333333-3333-4333-8333-333333333333',
      '55555555-5555-4555-8555-555555555555', null, 2);
    raise exception 'Unauthenticated position accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.headers',
  '{"x-inventory-id":"11111111-1111-4111-8111-111111111111","x-device-id":"metadata-device","x-device-token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);

do $$
declare
  product public.items%rowtype;
begin
  select * into product from public.items where id = '33333333-3333-4333-8333-333333333333';
  if product.usage_count <> 0 or product.product_url is not null or product.parts is not null
    or product.favorite is not null or product.rating is not null then
    raise exception 'Invalid metadata defaults';
  end if;
  update public.items set product_url = 'https://example.org/fish', parts = '02', favorite = false, rating = 0
    where id = product.id;
  update public.items set rating = 5 where id = product.id;
  begin
    update public.items set rating = 6 where id = product.id;
    raise exception 'Rating 6 accepted';
  exception when check_violation then null;
  end;
  begin
    update public.items set rating = -1 where id = product.id;
    raise exception 'Negative rating accepted';
  exception when check_violation then null;
  end;
  begin
    update public.items set product_url = 'javascript:alert(1)' where id = product.id;
    raise exception 'Unsafe URL accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.create_stock_position(gen_random_uuid(), '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555', null, 2);
    raise exception 'Foreign product accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- A direct insert is the import path and must not increment usage.
insert into public.stock_entries(inventory_id, item_id, location_id, quantity)
values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555', 8);

select public.create_stock_position('77777777-7777-4777-8777-777777777777',
  '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', null, 5);
select public.create_stock_position('77777777-7777-4777-8777-777777777777',
  '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', null, 5);
select public.create_stock_position('88888888-8888-4888-8888-888888888888',
  '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', null, 0);

do $$
begin
  if (select usage_count from public.items where id = '33333333-3333-4333-8333-333333333333') <> 2 then
    raise exception 'Usage must count creations, not quantity, import or retries';
  end if;
  begin
    perform public.create_stock_position('77777777-7777-4777-8777-777777777777',
      '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', null, 6);
    raise exception 'Changed retry accepted';
  exception when raise_exception then
    if sqlerrm = 'Changed retry accepted' then raise; end if;
  end;
  begin
    perform public.create_stock_position(gen_random_uuid(),
      '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', null, -1);
    raise exception 'Negative quantity accepted';
  exception when check_violation then null;
  end;
  begin
    update public.items set usage_count = 1 where id = '33333333-3333-4333-8333-333333333333';
    raise exception 'Usage reduction accepted';
  exception when check_violation then null;
  end;
end;
$$;

update public.stock_entries set location_id = '66666666-6666-4666-8666-666666666666', quantity = 1;
delete from public.stock_entries;
do $$
begin
  if (select usage_count from public.items where id = '33333333-3333-4333-8333-333333333333') <> 2 then
    raise exception 'Move, quantity edit, deletion or failed insert changed usage';
  end if;
  -- Integer overflow must roll back the position insertion as well.
  update public.items set usage_count = 2147483647 where id = '33333333-3333-4333-8333-333333333333';
  begin
    perform public.create_stock_position('99999999-9999-4999-8999-999999999999',
      '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', null, 1);
    raise exception 'Overflow accepted';
  exception when numeric_value_out_of_range then null;
  end;
  if exists (select 1 from public.stock_entries where id = '99999999-9999-4999-8999-999999999999') then
    raise exception 'Counter failure left a position behind';
  end if;
end;
$$;

rollback;
