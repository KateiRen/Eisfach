-- Existing installations only: back up first, then run once in the SQL editor.
-- Deploy the matching frontend immediately afterwards; old clients cannot write
-- quantity/location on items after this transaction.
begin;

lock table public.items in access exclusive mode;

alter table public.items
  add column preparation_minutes integer check (preparation_minutes >= 0),
  add column thawing_minutes integer check (thawing_minutes >= 0),
  add constraint items_inventory_id_id_key unique (inventory_id, id);

create table public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  item_id uuid not null,
  location text not null default '' check (char_length(location) <= 200),
  quantity integer not null default 1 check (quantity >= 0),
  -- Total weight of this position, not weight per piece; NULL means unknown.
  weight_grams numeric(12,3) check (
    weight_grams >= 0 and weight_grams < 1000000000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (inventory_id, item_id)
    references public.items(inventory_id, id) on delete cascade
);
create index stock_entries_item_idx on public.stock_entries(item_id);
create index stock_entries_inventory_idx on public.stock_entries(inventory_id);

-- Preserve all old products, including zero-stock ones. Never invent a weight.
-- Legacy location has no length constraint: reject rather than truncate data.
insert into public.stock_entries (inventory_id, item_id, location, quantity, created_at, updated_at)
select inventory_id, id, location, quantity, created_at, updated_at
from public.items
where quantity > 0;

alter table public.items drop column quantity, drop column location;

alter table public.stock_entries enable row level security;
revoke all on public.stock_entries from public, anon, authenticated;
grant select, insert, update, delete on public.stock_entries to anon, authenticated;
grant all on public.stock_entries to service_role;

create policy stock_read on public.stock_entries for select to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()));
create policy stock_insert on public.stock_entries for insert to anon, authenticated
  with check (inventory_id = (select public.current_inventory_id()));
create policy stock_update on public.stock_entries for update to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()))
  with check (inventory_id = (select public.current_inventory_id()));
create policy stock_delete on public.stock_entries for delete to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()));

create trigger stock_updated_at before update on public.stock_entries
  for each row execute function public.set_item_updated_at();

create function public.audit_stock_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  inventory uuid;
  product uuid;
begin
  if tg_op = 'DELETE' then
    inventory := old.inventory_id;
    product := old.item_id;
  else
    inventory := new.inventory_id;
    product := new.item_id;
  end if;
  if exists (select 1 from public.inventories where id = inventory) then
    insert into public.audit_log(inventory_id, action, item_id)
    values (inventory, 'stock.' || lower(tg_op), product);
  end if;
  return null;
end;
$$;
revoke all on function public.audit_stock_change() from public, anon, authenticated;
create trigger stock_audit after insert or update or delete on public.stock_entries
  for each row execute function public.audit_stock_change();

-- Does not change setup_inventory permissions (including a previous REVOKE).
notify pgrst, 'reload schema';
commit;
