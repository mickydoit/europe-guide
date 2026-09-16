-- Photos fetched at import: one per stop/booking, stored in the private `photos` bucket.
alter table items add column if not exists photo_path text;
alter table items add column if not exists photo_credit text;
alter table bookings add column if not exists photo_path text;
alter table bookings add column if not exists photo_credit text;

-- What Places answered for a given storage path, so a re-import never asks Google twice.
create table if not exists photo_cache (
  path text primary key,
  owner uuid not null default auth.uid(),
  place_id text, photo_name text, credit text,
  fetched_at timestamptz not null default now()
);
alter table photo_cache enable row level security;
create policy owner_all on photo_cache for all using (owner = auth.uid()) with check (owner = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit)
values ('photos','photos',false, 5242880)
on conflict (id) do nothing;
create policy photos_read on storage.objects for select
  using (bucket_id = 'photos' and auth.role() = 'authenticated');
