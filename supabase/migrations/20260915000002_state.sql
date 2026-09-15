create table item_checks (
  item_id text primary key, owner uuid not null default auth.uid(), done_at timestamptz not null default now()
);
create table booking_state (
  trip text not null, booking_id text not null, owner uuid not null default auth.uid(),
  status text check (status in ('not_booked','booked','confirmed','cancelled','undecided')),
  confirmation_ref text, cost numeric, currency text default 'EUR', notes text,
  updated_at timestamptz not null default now(),
  primary key (trip, booking_id)
);
create table attachments (
  id uuid primary key default gen_random_uuid(), owner uuid not null default auth.uid(),
  trip text not null, booking_id text not null, storage_path text not null,
  filename text not null, mime text not null, size bigint not null, uploaded_at timestamptz not null default now()
);
create table day_notes (
  trip text not null, date date not null, owner uuid not null default auth.uid(),
  text text, saved_places jsonb not null default '[]', updated_at timestamptz not null default now(),
  primary key (trip, date)
);
create table geocode_cache (
  query text primary key, owner uuid not null default auth.uid(),
  lat double precision, lng double precision, formatted_address text, place_id text,
  fetched_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['item_checks','booking_state','attachments','day_notes','geocode_cache'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy owner_all on %I for all using (owner = auth.uid()) with check (owner = auth.uid())', t);
  end loop;
end $$;
