-- Apply once to a fresh Supabase database as postgres (SQL editor or psql).
begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Future functions must be explicitly exposed; PostgreSQL otherwise grants EXECUTE to PUBLIC.
alter default privileges in schema public revoke execute on functions from public;

create table public.inventories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  created_at timestamptz not null default now()
);

create table public.join_tokens (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses > 0),
  uses integer not null default 0 check (uses between 0 and max_uses),
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.device_registrations (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  device_id text not null unique default gen_random_uuid()::text,
  device_token_hash bytea not null check (octet_length(device_token_hash) = 32),
  device_name text not null check (char_length(btrim(device_name)) between 1 and 200),
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index device_registrations_inventory_idx on public.device_registrations(inventory_id);
create index join_tokens_inventory_idx on public.join_tokens(inventory_id);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  product_number text not null default '' check (char_length(product_number) <= 100),
  -- Weight of one package, independent of quantities and storage positions.
  weight_grams numeric(12,3) check (weight_grams >= 0 and weight_grams < 1000000000),
  description text not null default '',
  category text not null default '',
  preparation_minutes integer check (preparation_minutes >= 0),
  thawing_minutes integer check (thawing_minutes >= 0),
  qr_code text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_id, id)
);
create index items_inventory_idx on public.items(inventory_id);

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

create table public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  item_id uuid not null,
  location_id uuid not null,
  compartment_id uuid,
  quantity integer not null default 1 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (inventory_id, item_id)
    references public.items(inventory_id, id) on delete cascade,
  foreign key (inventory_id, location_id)
    references public.storage_locations(inventory_id, id),
  foreign key (inventory_id, location_id, compartment_id)
    references public.storage_compartments(inventory_id, location_id, id)
);
create index stock_entries_item_idx on public.stock_entries(item_id);
create index stock_entries_inventory_idx on public.stock_entries(inventory_id);
create index stock_entries_location_idx on public.stock_entries(location_id, compartment_id);

create table public.item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  path text not null unique,
  caption text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index item_images_item_idx on public.item_images(item_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  action text not null,
  -- Keep the deleted item's ID for audit history instead of cascading its audit entries.
  item_id uuid,
  created_at timestamptz not null default now()
);
create index audit_log_inventory_created_idx on public.audit_log(inventory_id, created_at desc);

create table public.registration_rate_limits (
  key text primary key,
  window_start timestamptz not null,
  attempts integer not null
);

alter table public.inventories enable row level security;
alter table public.join_tokens enable row level security;
alter table public.device_registrations enable row level security;
alter table public.items enable row level security;
alter table public.stock_entries enable row level security;
alter table public.storage_locations enable row level security;
alter table public.storage_compartments enable row level security;
alter table public.item_images enable row level security;
alter table public.audit_log enable row level security;
alter table public.registration_rate_limits enable row level security;

-- Never expose the credential hash columns, even through SELECT * or RETURNING *.
revoke all on public.inventories, public.join_tokens, public.device_registrations,
  public.items, public.stock_entries, public.storage_locations, public.storage_compartments,
  public.item_images, public.audit_log, public.registration_rate_limits
  from public, anon, authenticated;
grant select on public.inventories, public.audit_log to anon, authenticated;
grant select, insert, update, delete on public.items, public.stock_entries, public.item_images to anon, authenticated;
grant select, insert, update, delete on public.storage_locations, public.storage_compartments to anon, authenticated;
grant select (id, inventory_id, device_id, device_name, revoked, created_at, last_seen_at)
  on public.device_registrations to anon, authenticated;
grant update (device_name) on public.device_registrations to anon, authenticated;
grant delete on public.device_registrations to anon, authenticated;
grant all on public.inventories, public.join_tokens, public.device_registrations,
  public.items, public.stock_entries, public.storage_locations, public.storage_compartments,
  public.item_images, public.audit_log, public.registration_rate_limits
  to service_role;

create function public.current_inventory_id()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  headers jsonb;
  inventory uuid;
begin
  headers := nullif(current_setting('request.headers', true), '')::jsonb;
  if headers is null or
    char_length(coalesce(headers->>'x-device-token', '')) <> 64 or
    char_length(coalesce(headers->>'x-device-id', '')) not between 1 and 128 then
    return null;
  end if;
  inventory := (headers->>'x-inventory-id')::uuid;
  if exists (
    select 1 from public.device_registrations d
    where d.inventory_id = inventory
      and d.device_id = headers->>'x-device-id'
      and not d.revoked
      and d.device_token_hash = extensions.digest(headers->>'x-device-token', 'sha256')
  ) then
    return inventory;
  end if;
  return null;
exception when invalid_text_representation then
  return null;
end;
$$;
revoke all on function public.current_inventory_id() from public, anon, authenticated;
grant execute on function public.current_inventory_id() to anon, authenticated;

create policy inventories_read on public.inventories for select to anon, authenticated
  using (id = (select public.current_inventory_id()));
create policy devices_read on public.device_registrations for select to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()));
create policy devices_rename on public.device_registrations for update to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()))
  with check (inventory_id = (select public.current_inventory_id()));
create policy devices_delete on public.device_registrations for delete to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()));
create policy items_read on public.items for select to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()));
create policy items_insert on public.items for insert to anon, authenticated
  with check (inventory_id = (select public.current_inventory_id()));
create policy items_update on public.items for update to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()))
  with check (inventory_id = (select public.current_inventory_id()));
create policy items_delete on public.items for delete to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()));
create policy stock_read on public.stock_entries for select to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()));
create policy stock_insert on public.stock_entries for insert to anon, authenticated
  with check (inventory_id = (select public.current_inventory_id()));
create policy stock_update on public.stock_entries for update to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()))
  with check (inventory_id = (select public.current_inventory_id()));
create policy stock_delete on public.stock_entries for delete to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()));
create policy locations_access on public.storage_locations for all to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()))
  with check (inventory_id = (select public.current_inventory_id()));
create policy compartments_access on public.storage_compartments for all to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()))
  with check (inventory_id = (select public.current_inventory_id()));
create policy audit_read on public.audit_log for select to anon, authenticated
  using (inventory_id = (select public.current_inventory_id()));

create function public.can_access_inventory_image(p_path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    array_length(string_to_array(p_path, '/'), 1) = 3
    and split_part(p_path, '/', 3) not in ('', '.', '..')
    and split_part(p_path, '/', 1) = public.current_inventory_id()::text
    and exists (
      select 1 from public.items i
      where i.id::text = split_part(p_path, '/', 2)
        and i.inventory_id = public.current_inventory_id()
    ), false
  );
$$;
revoke all on function public.can_access_inventory_image(text) from public, anon, authenticated;
grant execute on function public.can_access_inventory_image(text) to anon, authenticated;

create policy images_read on public.item_images for select to anon, authenticated
  using (
    split_part(path, '/', 2) = item_id::text
    and public.can_access_inventory_image(path)
  );
create policy images_insert on public.item_images for insert to anon, authenticated
  with check (
    split_part(path, '/', 2) = item_id::text
    and public.can_access_inventory_image(path)
  );
create policy images_update on public.item_images for update to anon, authenticated
  using (
    split_part(path, '/', 2) = item_id::text
    and public.can_access_inventory_image(path)
  )
  with check (
    split_part(path, '/', 2) = item_id::text
    and public.can_access_inventory_image(path)
  );
create policy images_delete on public.item_images for delete to anon, authenticated
  using (
    split_part(path, '/', 2) = item_id::text
    and public.can_access_inventory_image(path)
  );

insert into storage.buckets (id, name, public)
values ('inventory-images', 'inventory-images', false)
on conflict (id) do update set public = false;

-- The Edge gateway authenticates devices and checks item ownership before using
-- service_role. Do not depend on custom-header propagation by Storage itself.
-- RESTRICTIVE also prevents other permissive bucket policies from granting access.
create policy inventory_images_no_direct_access on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'inventory-images')
  with check (bucket_id <> 'inventory-images');

create function public.touch_device()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  inventory uuid := public.current_inventory_id();
begin
  if inventory is null then
    raise exception 'Invalid device credentials' using errcode = '28000';
  end if;
  update public.device_registrations
  set last_seen_at = now()
  where inventory_id = inventory
    and device_id = current_setting('request.headers', true)::jsonb->>'x-device-id'
    and not revoked;
end;
$$;
revoke all on function public.touch_device() from public, anon, authenticated;
grant execute on function public.touch_device() to anon, authenticated;

create function public.set_item_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.set_item_updated_at() from public, anon, authenticated;
create trigger items_updated_at before update on public.items
  for each row execute function public.set_item_updated_at();
create trigger stock_updated_at before update on public.stock_entries
  for each row execute function public.set_item_updated_at();
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

create function public.audit_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  inventory uuid;
  item uuid;
  action_name text;
begin
  if tg_table_name = 'items' then
    if tg_op = 'DELETE' then
      inventory := old.inventory_id;
      item := old.id;
    else
      inventory := new.inventory_id;
      item := new.id;
    end if;
    action_name := 'item.' || lower(tg_op);
  elsif tg_table_name = 'item_images' then
    if tg_op = 'DELETE' then item := old.item_id;
    else item := new.item_id;
    end if;
    select i.inventory_id into inventory from public.items i where i.id = item;
    -- Cascading image deletion is already covered by the parent item's delete event.
    action_name := 'image.' || lower(tg_op);
  elsif tg_table_name = 'device_registrations' then
    if tg_op = 'UPDATE' then
      -- Heartbeats must not flood the audit log.
      if new.device_name is not distinct from old.device_name
        and new.revoked is not distinct from old.revoked then return null; end if;
    end if;
    if tg_op = 'DELETE' then inventory := old.inventory_id;
    else inventory := new.inventory_id;
    end if;
    action_name := 'device.' || lower(tg_op);
  else
    inventory := new.id;
    action_name := 'inventory.insert';
  end if;
  if inventory is not null and exists (select 1 from public.inventories where id = inventory) then
    insert into public.audit_log(inventory_id, action, item_id)
    values (inventory, action_name, item);
  end if;
  return null;
end;
$$;
revoke all on function public.audit_change() from public, anon, authenticated;
create trigger inventory_audit after insert on public.inventories
  for each row execute function public.audit_change();
create trigger items_audit after insert or update or delete on public.items
  for each row execute function public.audit_change();
create trigger images_audit after insert or update or delete on public.item_images
  for each row execute function public.audit_change();
create trigger devices_audit after insert or update or delete on public.device_registrations
  for each row execute function public.audit_change();

create function public.setup_inventory(p_name text, p_description text, p_device_name text)
returns table(inventory_id uuid, device_id text, device_token text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  inventory uuid;
  device text := gen_random_uuid()::text;
  secret text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 200
    or char_length(coalesce(p_description, '')) > 4000
    or p_device_name is null or char_length(btrim(p_device_name)) not between 1 and 200 then
    raise exception 'Invalid inventory details' using errcode = '22023';
  end if;
  insert into public.inventories(name, description)
    values (btrim(p_name), coalesce(p_description, '')) returning id into inventory;
  insert into public.device_registrations(inventory_id, device_id, device_token_hash, device_name)
    values (inventory, device, extensions.digest(secret, 'sha256'), btrim(p_device_name));
  return query select inventory, device, secret;
end;
$$;
revoke all on function public.setup_inventory(text, text, text) from public, anon, authenticated;
grant execute on function public.setup_inventory(text, text, text) to service_role;

create function public.register_device(p_inventory_id uuid, p_join_token text, p_device_name text)
returns table(inventory_id uuid, device_id text, device_token text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  token public.join_tokens%rowtype;
  device text := gen_random_uuid()::text;
  secret text := encode(extensions.gen_random_bytes(32), 'hex');
  normalized_token text := upper(replace(btrim(p_join_token), '-', ''));
begin
  if p_device_name is null or char_length(btrim(p_device_name)) not between 1 and 200 then
    raise exception 'Invalid device name' using errcode = '22023';
  end if;
  if normalized_token is null or normalized_token !~ '^[A-HJ-NP-Z2-9]{12}$' then
    raise exception 'Invalid join token' using errcode = '28000';
  end if;
  select j.* into token from public.join_tokens j
    where j.inventory_id = p_inventory_id
      and j.token_hash = extensions.digest(normalized_token, 'sha256')
    for update;
  if not found or token.revoked or token.expires_at <= clock_timestamp()
    or token.uses >= token.max_uses then
    raise exception 'Invalid join token' using errcode = '28000';
  end if;
  update public.join_tokens j
    set uses = j.uses + 1, revoked = (j.uses + 1 >= j.max_uses)
    where j.id = token.id;
  insert into public.device_registrations(inventory_id, device_id, device_token_hash, device_name)
    values (p_inventory_id, device, extensions.digest(secret, 'sha256'), btrim(p_device_name));
  return query select p_inventory_id, device, secret;
end;
$$;
revoke all on function public.register_device(uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_device(uuid, text, text) to service_role;

-- Recheck and lock the caller after Edge authentication, preventing stale/revoked
-- credentials from authorizing a service-role write between the two requests.
create function public.lock_active_device(
  p_inventory_id uuid, p_device_id text, p_device_token text
)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform 1 from public.device_registrations d
    where d.inventory_id = p_inventory_id and d.device_id = p_device_id
      and not d.revoked
      and d.device_token_hash = extensions.digest(p_device_token, 'sha256')
    for update;
  if not found then
    raise exception 'Invalid device credentials' using errcode = '28000';
  end if;
end;
$$;
revoke all on function public.lock_active_device(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lock_active_device(uuid, text, text) to service_role;

create function public.issue_join_token(
  p_inventory_id uuid, p_caller_device_id text, p_caller_device_token text
)
returns table(join_token text, expires_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  random_bytes bytea := extensions.gen_random_bytes(12);
  secret text := '';
  n integer;
  expiry timestamptz := clock_timestamp() + interval '15 minutes';
begin
  perform public.lock_active_device(p_inventory_id, p_caller_device_id, p_caller_device_token);
  -- 32 unambiguous symbols; each uniform random byte contributes five unbiased bits.
  for n in 0..11 loop
    secret := secret || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(random_bytes, n) % 32) + 1, 1);
  end loop;
  insert into public.join_tokens(inventory_id, token_hash, expires_at, max_uses)
    values (p_inventory_id, extensions.digest(secret, 'sha256'), expiry, 1);
  return query select substr(secret, 1, 4) || '-' || substr(secret, 5, 4) || '-' || substr(secret, 9, 4), expiry;
end;
$$;
revoke all on function public.issue_join_token(uuid, text, text) from public, anon, authenticated;
grant execute on function public.issue_join_token(uuid, text, text) to service_role;

create function public.revoke_device(
  p_inventory_id uuid, p_device_id text, p_caller_device_id text, p_caller_device_token text
)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  -- Lock in deterministic order to avoid cross-revocation deadlocks.
  perform 1 from public.device_registrations d
    where d.inventory_id = p_inventory_id
      and d.device_id in (p_caller_device_id, p_device_id)
    order by d.device_id for update;
  perform public.lock_active_device(p_inventory_id, p_caller_device_id, p_caller_device_token);
  update public.device_registrations d set revoked = true
    where d.inventory_id = p_inventory_id and d.device_id = p_device_id;
  if not found then
    raise exception 'Unknown device' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.revoke_device(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.revoke_device(uuid, text, text, text) to service_role;

-- Separate RPC transaction: invalid join tokens cannot roll back their rate-limit debit.
create function public.consume_registration_attempt(p_inventory_id uuid, p_client_key text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  current_window timestamptz := date_trunc('minute', clock_timestamp());
  client_attempts integer;
  inventory_attempts integer;
begin
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid client key' using errcode = '22023';
  end if;
  delete from public.registration_rate_limits where window_start < current_window - interval '1 hour';
  insert into public.registration_rate_limits as r(key, window_start, attempts)
    values ('client:' || p_client_key, current_window, 1)
    on conflict (key) do update
      set attempts = case when r.window_start = current_window then least(r.attempts + 1, 1000000) else 1 end,
          window_start = current_window
    returning attempts into client_attempts;
  if client_attempts > 30 then return false; end if;
  insert into public.registration_rate_limits as r(key, window_start, attempts)
    values ('inventory:' || p_inventory_id::text, current_window, 1)
    on conflict (key) do update
      set attempts = case when r.window_start = current_window then least(r.attempts + 1, 1000000) else 1 end,
          window_start = current_window
    returning attempts into inventory_attempts;
  return inventory_attempts <= 60;
end;
$$;
revoke all on function public.consume_registration_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_registration_attempt(uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
