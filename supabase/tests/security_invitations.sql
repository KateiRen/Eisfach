-- Run as postgres against a disposable database initialized with schema.sql
-- or upgraded with update_security_invitations.sql. Never use production.
begin;

do $$
declare
  invitation record;
  first_device record;
  second_device record;
  third_device record;
  first_code text;
  second_code text;
  inventory_count integer;
begin
  select count(*) into inventory_count from public.inventories;
  begin
    perform public.setup_inventory('No invitation', '', 'Test', null);
    raise exception 'Missing invitation accepted';
  exception when invalid_authorization_specification then null;
  end;
  begin
    perform public.setup_inventory('Invalid invitation', '', 'Test', repeat('0', 64));
    raise exception 'Unknown invitation accepted';
  exception when invalid_authorization_specification then null;
  end;
  if (select count(*) from public.inventories) <> inventory_count then
    raise exception 'Rejected invitation created inventory';
  end if;

  select * into invitation from public.issue_inventory_invitation();
  update public.inventory_invitations set expires_at = clock_timestamp() - interval '1 second'
    where token_hash = extensions.digest(invitation.invitation_token, 'sha256');
  begin
    perform public.setup_inventory('Expired', '', 'Test', invitation.invitation_token);
    raise exception 'Expired invitation accepted';
  exception when invalid_authorization_specification then null;
  end;

  select * into invitation from public.issue_inventory_invitation();
  begin
    perform public.setup_inventory('', '', 'Test', invitation.invitation_token);
    raise exception 'Invalid inventory details accepted';
  exception when invalid_parameter_value then null;
  end;
  select * into first_device from public.setup_inventory(
    'Security test', '', 'First', upper(invitation.invitation_token));
  if (select used_at is null from public.inventory_invitations
      where token_hash = extensions.digest(invitation.invitation_token, 'sha256')) then
    raise exception 'Invitation was not consumed';
  end if;
  begin
    perform public.setup_inventory('Replay', '', 'Test', invitation.invitation_token);
    raise exception 'Invitation replay accepted';
  exception when invalid_authorization_specification then null;
  end;

  select join_token into first_code from public.issue_join_token(
    first_device.inventory_id, first_device.device_id, first_device.device_token);
  select * into second_device from public.register_device(first_device.inventory_id, first_code, 'Second');
  begin
    perform public.register_device(first_device.inventory_id, first_code, 'Replay');
    raise exception 'Join code replay accepted';
  exception when invalid_authorization_specification then null;
  end;
  select join_token into first_code from public.issue_join_token(
    first_device.inventory_id, first_device.device_id, first_device.device_token);
  select join_token into second_code from public.issue_join_token(
    second_device.inventory_id, second_device.device_id, second_device.device_token);
  perform public.revoke_device(first_device.inventory_id, first_device.device_id,
    second_device.device_id, second_device.device_token);
  begin
    perform public.register_device(first_device.inventory_id, first_code, 'Revoked issuer');
    raise exception 'Revoked device invitation accepted';
  exception when invalid_authorization_specification then null;
  end;
  if exists (select 1 from public.join_tokens where issued_by_device_id = first_device.device_id and not revoked) then
    raise exception 'Revoked issuer has open invitations';
  end if;
  -- The chosen policy preserves previously invited devices and their invitations.
  select * into third_device from public.register_device(second_device.inventory_id, second_code, 'Third');
  select join_token into second_code from public.issue_join_token(
    second_device.inventory_id, second_device.device_id, second_device.device_token);
  perform set_config('request.headers', jsonb_build_object(
    'x-inventory-id', third_device.inventory_id, 'x-device-id', third_device.device_id,
    'x-device-token', third_device.device_token)::text, true);
  set local role anon;
  delete from public.device_registrations where device_id = second_device.device_id;
  reset role;
  if exists (select 1 from public.join_tokens where issued_by_device_id = second_device.device_id) then
    raise exception 'Deleted issuer still has invitations';
  end if;
  begin
    perform public.register_device(third_device.inventory_id, second_code, 'Deleted issuer');
    raise exception 'Deleted device invitation accepted';
  exception when invalid_authorization_specification then null;
  end;
  if public.current_inventory_id() is distinct from third_device.inventory_id then
    raise exception 'Previously invited device lost access';
  end if;
end;
$$;

do $$
declare
  n integer;
  client text := encode(extensions.gen_random_bytes(32), 'hex');
  other_client text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  for n in 1..5 loop
    if not public.consume_public_attempt(client, 'create') then
      raise exception 'Creation limit blocked too soon';
    end if;
  end loop;
  if public.consume_public_attempt(client, 'create') then
    raise exception 'Creation limit not enforced';
  end if;
  for n in 1..30 loop
    if not public.consume_public_attempt(client, 'register') then
      raise exception 'Registration limit blocked too soon or shared creation budget';
    end if;
  end loop;
  if public.consume_public_attempt(client, 'register') then
    raise exception 'Registration limit not enforced';
  end if;
  if not public.consume_public_attempt(other_client, 'register') then
    raise exception 'One client blocked another client';
  end if;
  update public.registration_rate_limits
    set window_start = date_trunc('minute', clock_timestamp()) - interval '1 minute'
    where key = 'register:' || client;
  if not public.consume_public_attempt(client, 'register') then
    raise exception 'New minute did not reset the client limit';
  end if;
  begin
    perform public.consume_public_attempt(client, 'other');
    raise exception 'Unknown rate-limit action accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

do $$
declare
  role_name text;
begin
  if to_regprocedure('public.setup_inventory(text,text,text)') is not null then
    raise exception 'Unguarded setup_inventory signature still exists';
  end if;
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_function_privilege(role_name, 'public.issue_inventory_invitation()', 'execute')
      or has_function_privilege(role_name, 'public.setup_inventory(text,text,text,text)', 'execute')
      or has_function_privilege(role_name, 'public.consume_public_attempt(text,text)', 'execute')
      or has_table_privilege(role_name, 'public.inventory_invitations', 'select')
      or has_table_privilege(role_name, 'public.inventory_invitations', 'insert') then
      raise exception 'Browser role can bypass invitation gateway: %', role_name;
    end if;
  end loop;
end;
$$;

rollback;
