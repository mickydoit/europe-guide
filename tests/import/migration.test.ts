import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'
const sql = readFileSync('supabase/migrations/20260916000007_photos.sql', 'utf8')
test('photo columns, cache table, bucket and policies', () => {
  expect(sql).toMatch(/alter table items add column if not exists photo_path text/)
  expect(sql).toMatch(/alter table items add column if not exists photo_credit text/)
  expect(sql).toMatch(/alter table bookings add column if not exists photo_path text/)
  expect(sql).toMatch(/alter table bookings add column if not exists photo_credit text/)
  expect(sql).toMatch(/create table if not exists photo_cache/)
  expect(sql).toMatch(/enable row level security/)
  expect(sql).toMatch(/'photos','photos',false/)
  expect(sql).toMatch(/bucket_id = 'photos' and auth.role\(\) = 'authenticated'/)
})
