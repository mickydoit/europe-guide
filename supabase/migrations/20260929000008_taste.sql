-- supabase/migrations/20260929000008_taste.sql
-- Google Place Details metadata for the owner's chosen places (spec 2026-09-29 taste profile).
-- Nullable everywhere: content imported before this migration simply has none.
alter table items add column if not exists primary_type text;
alter table items add column if not exists types text[];
alter table items add column if not exists price_level text;
alter table items add column if not exists rating numeric;
alter table items add column if not exists rating_count integer;

alter table parked_venues add column if not exists primary_type text;
alter table parked_venues add column if not exists types text[];
alter table parked_venues add column if not exists price_level text;
alter table parked_venues add column if not exists rating numeric;
alter table parked_venues add column if not exists rating_count integer;

-- Details is billed per call, so the answer is kept beside the geocode it belongs to.
alter table geocode_cache add column if not exists primary_type text;
alter table geocode_cache add column if not exists types text[];
alter table geocode_cache add column if not exists price_level text;
alter table geocode_cache add column if not exists rating numeric;
alter table geocode_cache add column if not exists rating_count integer;
alter table geocode_cache add column if not exists meta_fetched_at timestamptz;

-- One vote per Google place: +1 (saved to notes) or -1 (Not for us). Last vote wins.
create table if not exists place_votes (
  place_id text primary key,
  owner uuid not null default auth.uid(),
  primary_type text,
  vote smallint not null check (vote in (-1, 1)),
  voted_at timestamptz not null default now()
);
alter table place_votes enable row level security;
create policy owner_all on place_votes for all using (owner = auth.uid()) with check (owner = auth.uid());
