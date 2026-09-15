insert into storage.buckets (id, name, public, file_size_limit)
values ('tickets','tickets',false, 26214400), ('maps','maps',false, 314572800)
on conflict (id) do nothing;

create policy tickets_owner on storage.objects for all
  using (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy maps_read on storage.objects for select
  using (bucket_id = 'maps' and auth.role() = 'authenticated');
