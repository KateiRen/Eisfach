-- Existing installations: back up first and deploy the matching frontend afterwards.
begin;
lock table public.stock_entries in access exclusive mode;

create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  updated_at timestamptz not null default now(),
  unique (inventory_id, id),
  unique (inventory_id, name)
);
create table public.storage_compartments (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  location_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  updated_at timestamptz not null default now(),
  foreign key (inventory_id, location_id)
    references public.storage_locations(inventory_id, id) on delete cascade,
  unique (inventory_id, location_id, id),
  unique (location_id, name)
);

insert into public.storage_locations(inventory_id, name)
select distinct inventory_id, location from public.stock_entries where btrim(location) <> '';
-- Empty legacy locations receive a defined placeholder instead of losing stock.
insert into public.storage_locations(inventory_id, name)
select distinct inventory_id, 'Ohne Ortsangabe' from public.stock_entries where btrim(location) = ''
on conflict (inventory_id, name) do nothing;

alter table public.stock_entries add column location_id uuid, add column compartment_id uuid;
update public.stock_entries s set location_id = l.id
from public.storage_locations l
where l.inventory_id = s.inventory_id
  and l.name = case when btrim(s.location) = '' then 'Ohne Ortsangabe' else s.location end;
alter table public.stock_entries
  alter column location_id set not null,
  add foreign key (inventory_id, location_id)
    references public.storage_locations(inventory_id, id),
  add foreign key (inventory_id, location_id, compartment_id)
    references public.storage_compartments(inventory_id, location_id, id),
  drop column location;
create index stock_entries_location_idx on public.stock_entries(location_id, compartment_id);

alter table public.storage_locations enable row level security;
alter table public.storage_compartments enable row level security;
revoke all on public.storage_locations, public.storage_compartments from public, anon, authenticated;
grant select, insert, update, delete on public.storage_locations, public.storage_compartments to anon, authenticated;
grant all on public.storage_locations, public.storage_compartments to service_role;
create policy locations_access on public.storage_locations for all to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()))
  with check (inventory_id = (select public.current_inventory_id()));
create policy compartments_access on public.storage_compartments for all to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()))
  with check (inventory_id = (select public.current_inventory_id()));
create trigger locations_updated_at before update on public.storage_locations
  for each row execute function public.set_item_updated_at();
create trigger compartments_updated_at before update on public.storage_compartments
  for each row execute function public.set_item_updated_at();

create function public.delete_storage_location(
  p_location_id uuid, p_compartment_id uuid, p_updated_at timestamptz,
  p_target_location_id uuid, p_target_compartment_id uuid
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  inventory uuid := public.current_inventory_id();
  source_version timestamptz;
  moved integer;
begin
  if inventory is null then
    raise exception 'Kein berechtigtes Gerät.' using errcode = '42501';
  end if;
  -- Serialize relocations within the inventory and lock out concurrent deletion.
  perform id from public.storage_locations
    where inventory_id = inventory order by id for update;
  if p_compartment_id is null then
    select updated_at into source_version from public.storage_locations
      where inventory_id = inventory and id = p_location_id;
  else
    select updated_at into source_version from public.storage_compartments
      where inventory_id = inventory and location_id = p_location_id
        and id = p_compartment_id for update;
  end if;
  if source_version is null or source_version is distinct from p_updated_at then
    raise exception 'Ort oder Fach wurde zwischenzeitlich geändert oder entfernt. Bitte neu laden.';
  end if;
  if p_target_location_id is null then
    if p_target_compartment_id is not null or exists (
      select 1 from public.stock_entries where inventory_id = inventory
        and location_id = p_location_id
        and (p_compartment_id is null or compartment_id = p_compartment_id)
    ) then
      raise exception 'Bitte einen Ersatzort für die vorhandenen Bestände auswählen.';
    end if;
  else
    if not exists (
      select 1 from public.storage_locations
      where inventory_id = inventory and id = p_target_location_id
    ) or (p_compartment_id is null and p_target_location_id = p_location_id)
      or (p_compartment_id is not null and p_target_compartment_id = p_compartment_id) then
      raise exception 'Ungültiger Ersatzort.';
    end if;
    if p_target_compartment_id is not null and not exists (
      select 1 from public.storage_compartments
      where inventory_id = inventory and location_id = p_target_location_id
        and id = p_target_compartment_id
    ) then
      raise exception 'Das Ersatzfach gehört nicht zum gewählten Ort.';
    end if;
  end if;
  update public.stock_entries
    set location_id = p_target_location_id, compartment_id = p_target_compartment_id
    where inventory_id = inventory and location_id = p_location_id
      and (p_compartment_id is null or compartment_id = p_compartment_id);
  get diagnostics moved = row_count;
  if p_compartment_id is null then
    delete from public.storage_locations where inventory_id = inventory and id = p_location_id;
  else
    delete from public.storage_compartments
      where inventory_id = inventory and location_id = p_location_id and id = p_compartment_id;
  end if;
  return moved;
end;
$$;
revoke all on function public.delete_storage_location(uuid, uuid, timestamptz, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_storage_location(uuid, uuid, timestamptz, uuid, uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
