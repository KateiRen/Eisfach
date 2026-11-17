-- Existing installations after update_order_receiving.sql: back up, pause
-- onboarding, run once, then redeploy createInventory and registerDevice.
-- Outstanding legacy join codes are revoked; existing devices retain access.
begin;

lock table public.device_registrations, public.join_tokens in share row exclusive mode;

create table public.inventory_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.inventory_invitations enable row level security;
revoke all on public.inventory_invitations from public, anon, authenticated;
grant all on public.inventory_invitations to service_role;

alter table public.join_tokens add column issued_by_device_id text
  references public.device_registrations(device_id) on delete cascade;
update public.join_tokens set revoked = true;
alter table public.join_tokens add constraint join_tokens_issuer_required
  check (revoked or issued_by_device_id is not null);
create index join_tokens_issuer_idx on public.join_tokens(issued_by_device_id);

create function public.issue_inventory_invitation()
returns table(invitation_token text, expires_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  secret text := encode(extensions.gen_random_bytes(32), 'hex');
  expiry timestamptz := clock_timestamp() + interval '24 hours';
begin
  insert into public.inventory_invitations(token_hash, expires_at)
    values (extensions.digest(secret, 'sha256'), expiry);
  return query select secret, expiry;
end;
$$;
revoke all on function public.issue_inventory_invitation() from public, anon, authenticated;
grant execute on function public.issue_inventory_invitation() to service_role;

-- Remove the old unguarded signature instead of leaving an alternate entry point.
drop function public.setup_inventory(text, text, text);
create function public.setup_inventory(
  p_name text, p_description text, p_device_name text, p_invitation_token text
)
returns table(inventory_id uuid, device_id text, device_token text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  inventory uuid;
  device text := gen_random_uuid()::text;
  secret text := encode(extensions.gen_random_bytes(32), 'hex');
  invitation public.inventory_invitations%rowtype;
  normalized_token text := lower(btrim(p_invitation_token));
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 200
    or char_length(coalesce(p_description, '')) > 4000
    or p_device_name is null or char_length(btrim(p_device_name)) not between 1 and 200 then
    raise exception 'Invalid inventory details' using errcode = '22023';
  end if;
  if normalized_token is null or normalized_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid inventory invitation' using errcode = '28000';
  end if;
  select i.* into invitation from public.inventory_invitations i
    where i.token_hash = extensions.digest(normalized_token, 'sha256')
    for update;
  if not found or invitation.used_at is not null or invitation.expires_at <= clock_timestamp() then
    raise exception 'Invalid inventory invitation' using errcode = '28000';
  end if;
  update public.inventory_invitations set used_at = clock_timestamp() where id = invitation.id;
  insert into public.inventories(name, description)
    values (btrim(p_name), coalesce(p_description, '')) returning id into inventory;
  insert into public.device_registrations(inventory_id, device_id, device_token_hash, device_name)
    values (inventory, device, extensions.digest(secret, 'sha256'), btrim(p_device_name));
  return query select inventory, device, secret;
end;
$$;
revoke all on function public.setup_inventory(text, text, text, text) from public, anon, authenticated;
grant execute on function public.setup_inventory(text, text, text, text) to service_role;

create or replace function public.register_device(p_inventory_id uuid, p_join_token text, p_device_name text)
returns table(inventory_id uuid, device_id text, device_token text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  token public.join_tokens%rowtype;
  issuer text;
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
  select j.issued_by_device_id into issuer from public.join_tokens j
    where j.inventory_id = p_inventory_id
      and j.token_hash = extensions.digest(normalized_token, 'sha256');
  -- Lock the issuer before the token, matching device revocation's lock order.
  perform 1 from public.device_registrations d
    where d.inventory_id = p_inventory_id and d.device_id = issuer and not d.revoked
    for share;
  if not found then
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

create or replace function public.issue_join_token(
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
  for n in 0..11 loop
    secret := secret || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(random_bytes, n) % 32) + 1, 1);
  end loop;
  insert into public.join_tokens(inventory_id, issued_by_device_id, token_hash, expires_at, max_uses)
    values (p_inventory_id, p_caller_device_id, extensions.digest(secret, 'sha256'), expiry, 1);
  return query select substr(secret, 1, 4) || '-' || substr(secret, 5, 4) || '-' || substr(secret, 9, 4), expiry;
end;
$$;
revoke all on function public.issue_join_token(uuid, text, text) from public, anon, authenticated;
grant execute on function public.issue_join_token(uuid, text, text) to service_role;

create function public.revoke_device_join_tokens()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.join_tokens set revoked = true
    where issued_by_device_id = new.device_id and not revoked;
  return null;
end;
$$;
revoke all on function public.revoke_device_join_tokens() from public, anon, authenticated;
create trigger devices_revoke_join_tokens after update of revoked on public.device_registrations
  for each row when (new.revoked and not old.revoked)
  execute function public.revoke_device_join_tokens();

create function public.consume_public_attempt(p_client_key text, p_action text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  current_window timestamptz := date_trunc('minute', clock_timestamp());
  client_attempts integer;
  attempt_limit integer;
begin
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$'
    or p_action is null or p_action not in ('create', 'register') then
    raise exception 'Invalid client key' using errcode = '22023';
  end if;
  attempt_limit := case when p_action = 'create' then 5 else 30 end;
  delete from public.registration_rate_limits where window_start < current_window - interval '1 hour';
  insert into public.registration_rate_limits as r(key, window_start, attempts)
    values (p_action || ':' || p_client_key, current_window, 1)
    on conflict (key) do update
      set attempts = case when r.window_start = current_window then least(r.attempts + 1, 1000000) else 1 end,
          window_start = current_window
    returning attempts into client_attempts;
  return client_attempts <= attempt_limit;
end;
$$;
revoke all on function public.consume_public_attempt(text, text) from public, anon, authenticated;
grant execute on function public.consume_public_attempt(text, text) to service_role;
drop function public.consume_registration_attempt(uuid, text);
delete from public.registration_rate_limits;

notify pgrst, 'reload schema';
commit;
