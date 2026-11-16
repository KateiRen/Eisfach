-- Existing installations after update_product_orders.sql: run once before
-- deploying the matching frontend. Fresh databases use schema.sql instead.
begin;

create function public.receive_order(
  p_order_id uuid, p_item_id uuid, p_updated_at timestamptz,
  p_id uuid, p_location_id uuid, p_compartment_id uuid, p_quantity integer
)
returns setof public.stock_entries
language plpgsql
set search_path = ''
as $$
declare
  inventory uuid := public.current_inventory_id();
  ordered public.order_entries%rowtype;
  position public.stock_entries%rowtype;
begin
  if inventory is null then
    raise exception 'Kein berechtigtes Gerät.' using errcode = '42501';
  end if;
  -- Match the lock order of create_stock_position; serialize retries for this product.
  perform 1 from public.items where id = p_item_id and inventory_id = inventory for update;
  if not found then
    raise exception 'Produkt nicht verfügbar.' using errcode = '42501';
  end if;
  if exists (select 1 from public.stock_entries where id = p_id and inventory_id = inventory) then
    return query select * from public.create_stock_position(
      p_id, p_item_id, p_location_id, p_compartment_id, p_quantity);
    return;
  end if;
  select * into ordered from public.order_entries
    where id = p_order_id and inventory_id = inventory and item_id = p_item_id for update;
  if not found or ordered.updated_at is distinct from p_updated_at then
    raise exception 'Bestelleintrag wurde zwischenzeitlich geändert oder entfernt. Bitte die Bestellliste aktualisieren.';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > ordered.quantity then
    raise exception 'Bitte mindestens ein Stück und höchstens die offene Bestellmenge einlagern.' using errcode = '23514';
  end if;
  select * into position from public.create_stock_position(
    p_id, p_item_id, p_location_id, p_compartment_id, p_quantity);
  if p_quantity = ordered.quantity then
    delete from public.order_entries where id = ordered.id;
  else
    update public.order_entries set quantity = quantity - p_quantity where id = ordered.id;
  end if;
  return next position;
end;
$$;
revoke all on function public.receive_order(uuid, uuid, timestamptz, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.receive_order(uuid, uuid, timestamptz, uuid, uuid, uuid, integer)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
