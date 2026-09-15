create or replace function import_city(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_slug text := p->'trip'->>'slug'; counts jsonb := '{}';
begin
  delete from offline_areas where trip = v_slug; delete from standing_notes where trip = v_slug; delete from parked_venues where trip = v_slug;
  delete from alerts where trip = v_slug; delete from legs where trip = v_slug; delete from routes where trip = v_slug;
  delete from bookings where trip = v_slug; delete from items where trip = v_slug; delete from days where trip = v_slug; delete from trips where slug = v_slug;
  insert into trips select * from jsonb_populate_record(null::trips, p->'trip');
  insert into days select * from jsonb_populate_recordset(null::days, p->'days');
  insert into items select * from jsonb_populate_recordset(null::items, p->'items') order by (parent_item is not null), sort;
  insert into bookings select * from jsonb_populate_recordset(null::bookings, p->'bookings');
  insert into routes select * from jsonb_populate_recordset(null::routes, p->'routes');
  insert into legs select * from jsonb_populate_recordset(null::legs, p->'legs');
  insert into alerts select * from jsonb_populate_recordset(null::alerts, p->'alerts');
  insert into parked_venues select * from jsonb_populate_recordset(null::parked_venues, p->'parked');
  insert into standing_notes select * from jsonb_populate_recordset(null::standing_notes, p->'notes');
  insert into offline_areas select * from jsonb_populate_recordset(null::offline_areas, p->'areas');
  select jsonb_object_agg(k, v) into counts from (values
    ('days', jsonb_array_length(p->'days')), ('items', jsonb_array_length(p->'items')), ('bookings', jsonb_array_length(p->'bookings')),
    ('routes', jsonb_array_length(p->'routes')), ('legs', jsonb_array_length(p->'legs')), ('alerts', jsonb_array_length(p->'alerts')),
    ('parked', jsonb_array_length(p->'parked')), ('notes', jsonb_array_length(p->'notes')), ('areas', jsonb_array_length(p->'areas'))) t(k, v);
  return counts;
end $$;
revoke all on function import_city(jsonb) from public, anon, authenticated;
grant execute on function import_city(jsonb) to service_role;
