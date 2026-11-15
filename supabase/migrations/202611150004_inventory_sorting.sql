-- Existing installations: apply after the product details migration, before deploying the frontend.
begin;

create table public.inventory_sorting (
  inventory_id uuid primary key references public.inventories(id) on delete cascade,
  categories text[] not null default '{}'
    check (array_ndims(categories) <= 1 and array_position(categories, null) is null),
  locations uuid[] not null default '{}'
    check (array_ndims(locations) <= 1 and array_position(locations, null) is null),
  compartments uuid[] not null default '{}'
    check (array_ndims(compartments) <= 1 and array_position(compartments, null) is null),
  updated_at timestamptz not null default now()
);
alter table public.inventory_sorting enable row level security;
revoke all on public.inventory_sorting from public, anon, authenticated;
grant select, insert, update on public.inventory_sorting to anon, authenticated;
grant all on public.inventory_sorting to service_role;
create policy sorting_read on public.inventory_sorting for select to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()));
create policy sorting_insert on public.inventory_sorting for insert to anon, authenticated
  with check (inventory_id = (select public.current_inventory_id()));
create policy sorting_update on public.inventory_sorting for update to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()))
  with check (inventory_id = (select public.current_inventory_id()));
create trigger sorting_updated_at before update on public.inventory_sorting
  for each row execute function public.set_item_updated_at();

notify pgrst, 'reload schema';
commit;
