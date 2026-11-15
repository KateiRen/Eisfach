-- Existing installations: back up first and deploy the matching frontend afterwards.
begin;
lock table public.items, public.stock_entries in access exclusive mode;

do $$
declare
  conflicts text;
begin
  select string_agg(format('%s (%s): %s g', name, id, weights), E'\n' order by name, id)
  into conflicts
  from (
    select i.id, i.name, string_agg(distinct s.weight_grams::text, ', ') as weights
    from public.items i
    join public.stock_entries s on s.item_id = i.id
    where s.weight_grams is not null
    group by i.id, i.name
    having count(distinct s.weight_grams) > 1
  ) conflicting_products;
  if conflicts is not null then
    raise exception 'Unterschiedliche Packungsgewichte für dasselbe Produkt.'
      using detail = conflicts,
        hint = 'Bestandsgewichte dieser Produkte vor der Migration abgleichen. Es wurde nichts übernommen.';
  end if;
end;
$$;

alter table public.items
  add column product_number text not null default '' check (char_length(product_number) <= 100),
  add column weight_grams numeric(12,3) check (weight_grams >= 0 and weight_grams < 1000000000);

update public.items i
set product_number = coalesce(btrim((regexp_match(i.notes, '^Nr:[ \t]*([^\r\n]*)', 'in'))[1]), ''),
    weight_grams = (select min(s.weight_grams) from public.stock_entries s where s.item_id = i.id);

-- Quantity zero stays zero. Notes, positions and product IDs are preserved.
alter table public.stock_entries drop column weight_grams;

notify pgrst, 'reload schema';
commit;
