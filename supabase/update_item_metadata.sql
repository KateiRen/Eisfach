-- Existing installations on the current baseline: back up, pause writes, run once,
-- then deploy the matching frontend. Fresh databases use schema.sql instead.
begin;
lock table public.items, public.stock_entries in access exclusive mode;

alter table public.items
  add column product_url text check (product_url ~ '^https?://[^[:space:]]+$'),
  add column parts text,
  add column favorite boolean,
  add column usage_count integer not null default 0 check (usage_count >= 0),
  add column rating integer check (rating between 0 and 5);

update public.items
set parts = nullif(btrim((regexp_match(notes, '^Teile:[ \t]*([^\r\n]*)', 'in'))[1]), '')
where notes ~* '^Teile:' or notes ~* E'\nTeile:';

create function public.preserve_item_usage_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.usage_count < old.usage_count then
    raise exception 'Der Nutzungscounter darf nicht reduziert werden.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_item_usage_count() from public, anon, authenticated;
create trigger items_usage_count before update on public.items
  for each row execute function public.preserve_item_usage_count();

create function public.create_stock_position(
  p_id uuid, p_item_id uuid, p_location_id uuid, p_compartment_id uuid, p_quantity integer
)
returns setof public.stock_entries
language plpgsql
set search_path = ''
as $$
declare
  inventory uuid := public.current_inventory_id();
  existing public.stock_entries%rowtype;
begin
  if inventory is null then
    raise exception 'Kein berechtigtes Gerät.' using errcode = '42501';
  end if;
  -- Serialize position creation and counter changes for the same product.
  perform 1 from public.items where id = p_item_id and inventory_id = inventory for update;
  if not found then
    raise exception 'Produkt nicht verfügbar.' using errcode = '42501';
  end if;
  select * into existing from public.stock_entries where id = p_id and inventory_id = inventory;
  if found then
    if existing.item_id is distinct from p_item_id
      or existing.location_id is distinct from p_location_id
      or existing.compartment_id is distinct from p_compartment_id
      or existing.quantity is distinct from p_quantity then
      raise exception 'Diese Position wurde bereits mit anderen Werten gespeichert. Bitte schließen und die Liste prüfen.';
    end if;
    return next existing;
    return;
  end if;
  insert into public.stock_entries(id, inventory_id, item_id, location_id, compartment_id, quantity)
    values (p_id, inventory, p_item_id, p_location_id, p_compartment_id, p_quantity)
    returning * into existing;
  update public.items set usage_count = usage_count + 1
    where id = p_item_id and inventory_id = inventory;
  return next existing;
end;
$$;
revoke all on function public.create_stock_position(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.create_stock_position(uuid, uuid, uuid, uuid, integer)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
