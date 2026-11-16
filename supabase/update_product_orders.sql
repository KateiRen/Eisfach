-- Existing installations after update_item_metadata.sql: back up, pause writes,
-- run once, then deploy the matching frontend. Fresh databases use schema.sql.
begin;

alter table public.items
  add column price numeric(10,2) check (price >= 0 and price < 100000000);

create table public.order_entries (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  item_id uuid not null,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (inventory_id, item_id)
    references public.items(inventory_id, id) on delete cascade,
  unique (inventory_id, item_id)
);
alter table public.order_entries enable row level security;
revoke all on public.order_entries from public, anon, authenticated;
grant select, insert, update, delete on public.order_entries to anon, authenticated;
grant all on public.order_entries to service_role;
create policy orders_access on public.order_entries for all to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()))
  with check (inventory_id = (select public.current_inventory_id()));
create trigger orders_updated_at before update on public.order_entries
  for each row execute function public.set_item_updated_at();

create function public.reorder_product(p_item_id uuid)
returns setof public.order_entries
language plpgsql
set search_path = ''
as $$
declare
  inventory uuid := public.current_inventory_id();
begin
  if inventory is null then
    raise exception 'Kein berechtigtes Gerät.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.items where id = p_item_id and inventory_id = inventory) then
    raise exception 'Produkt nicht verfügbar.' using errcode = '42501';
  end if;
  return query
    insert into public.order_entries as orders (inventory_id, item_id, quantity)
    values (inventory, p_item_id, 1)
    on conflict (inventory_id, item_id) do update set quantity = orders.quantity + 1
    returning orders.*;
end;
$$;
revoke all on function public.reorder_product(uuid) from public, anon, authenticated;
grant execute on function public.reorder_product(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
