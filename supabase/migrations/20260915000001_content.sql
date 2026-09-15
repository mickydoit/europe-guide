create extension if not exists pgcrypto;

create table trips (
  slug text primary key,
  owner uuid not null default auth.uid(),
  name text not null, country text not null, country_code text not null,
  start_date date not null, end_date date not null,
  base text, timezone text not null, intro text, sort int not null default 0
);
create table days (
  trip text not null references trips(slug) on delete cascade,
  date date not null,
  owner uuid not null default auth.uid(),
  title text, status text check (status in ('locked','locked_except_dinner')), intro text,
  primary key (trip, date)
);
create table items (
  id text primary key,
  owner uuid not null default auth.uid(),
  trip text not null references trips(slug) on delete cascade,
  date date not null,
  block text check (block in ('morning','midday','evening')),
  time time, time_text text, approx boolean not null default false,
  kind text not null check (kind in ('stop','option','note','route_link')),
  parent_item text references items(id) on delete cascade,
  plan text not null, details text, sort int not null,
  place_name text, address text, lat double precision, lng double precision,
  url text, route_id text
);
create index items_trip_date on items(trip, date, sort);
create table bookings (
  id text not null,
  trip text not null references trips(slug) on delete cascade,
  owner uuid not null default auth.uid(),
  kind text not null check (kind in ('booked','todo','walkin')),
  title text not null, date date, time time, priority text,
  book_by date, decide_by date, contact text, address text, notes text, fallback text,
  relates_to text, options text, status_from_file text, fields jsonb not null default '{}',
  sort int not null default 0,
  primary key (trip, id)
);
create table routes (
  id text not null,
  trip text not null references trips(slug) on delete cascade,
  owner uuid not null default auth.uid(),
  date date, title text not null, distance_text text,
  mode text not null default 'walking' check (mode in ('walking','driving','transit')),
  covers text[] not null default '{}', note text, google_url text not null, sort int not null default 0,
  primary key (trip, id)
);
create table legs (
  trip text not null, route_id text not null, seq int not null,
  owner uuid not null default auth.uid(),
  from_name text not null, to_name text not null,
  from_lat double precision, from_lng double precision, to_lat double precision, to_lng double precision,
  google_url text not null, polyline text, distance_m int, duration_s int,
  primary key (trip, route_id, seq),
  foreign key (trip, route_id) references routes(trip, id) on delete cascade
);
create table alerts (
  trip text not null references trips(slug) on delete cascade,
  date date not null, seq int not null,
  owner uuid not null default auth.uid(),
  time time, text text not null,
  primary key (trip, date, seq)
);
create table parked_venues (
  trip text not null references trips(slug) on delete cascade, seq int not null,
  owner uuid not null default auth.uid(),
  name text not null, what text, why text, address text, lat double precision, lng double precision,
  primary key (trip, seq)
);
create table standing_notes (
  trip text not null references trips(slug) on delete cascade, seq int not null,
  owner uuid not null default auth.uid(),
  section text not null, text text not null,
  primary key (trip, seq)
);
create table offline_areas (
  trip text not null references trips(slug) on delete cascade, seq int not null,
  owner uuid not null default auth.uid(),
  name text not null, min_lng double precision not null, min_lat double precision not null,
  max_lng double precision not null, max_lat double precision not null,
  pmtiles_path text not null, size_bytes bigint not null, built_at timestamptz not null default now(),
  primary key (trip, seq)
);

do $$ declare t text; begin
  foreach t in array array['trips','days','items','bookings','routes','legs','alerts','parked_venues','standing_notes','offline_areas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy owner_all on %I for all using (owner = auth.uid()) with check (owner = auth.uid())', t);
  end loop;
end $$;
