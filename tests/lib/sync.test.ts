import '../helpers/blobClone'
import { renderHook, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resetDbForTests } from '../../src/lib/db'
import { enqueue, listOutbox, updateOp } from '../../src/lib/outbox'
import { flushOutbox, retryFailed, startSync, useSync, notify, resetSyncForTests } from '../../src/lib/sync'

type Err = { message: string; code?: string } | null
type Call = { op: string; table?: string; bucket?: string; path?: string; payload?: unknown; filters?: Array<[string, unknown]>; upsertOpts?: unknown; body?: string }

/** A Supabase stand-in that records every call and can be told to fail the first N of them. */
function fakeClient(calls: Call[], fail: () => Err = () => null) {
  function from(table: string) {
    let op = 'select'
    let payload: unknown
    let upsertOpts: unknown
    const filters: Array<[string, unknown]> = []
    const q: Record<string, unknown> = {
      select() { return q },
      single() { return q },
      insert(p: unknown) { op = 'insert'; payload = p; return q },
      delete() { op = 'delete'; return q },
      upsert(p: unknown, o: unknown) { op = 'upsert'; payload = p; upsertOpts = o; return q },
      eq(c: string, v: unknown) { filters.push([c, v]); return q },
      then(resolve: (r: { data: unknown; error: Err }) => void) {
        calls.push({ op, table, payload, filters, upsertOpts })
        const error = fail()
        resolve({ data: error ? null : payload, error })
      },
    }
    return q
  }
  const storage = {
    from(bucket: string) {
      return {
        async upload(path: string, blob: Blob, opts: unknown) {
          calls.push({ op: 'upload', bucket, path, payload: opts, body: await blob.text() })
          const error = fail()
          return { data: error ? null : { path }, error }
        },
      }
    },
  }
  return { from, storage } as unknown as SupabaseClient
}

function failNTimes(n: number, err: Err = { message: 'network down' }) {
  let seen = 0
  return () => (seen++ < n ? err : null)
}

async function wipe() {
  await resetDbForTests()
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase('europe-guide')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => { await wipe(); resetSyncForTests() })
afterEach(() => { vi.useRealTimers() })

test('replays a check_set insert and removes the op', async () => {
  const calls: Call[] = []
  await enqueue({ key: 'check:valle/a', kind: 'check_set', payload: { itemId: 'valle/a', done: true } })
  const res = await flushOutbox(fakeClient(calls), soon(), () => true)
  expect(res).toEqual({ done: 1, remaining: 0, failed: 0 })
  expect(calls).toHaveLength(1)
  expect(calls[0].table).toBe('item_checks')
  expect(calls[0].op).toBe('insert')
  expect(calls[0].payload).toEqual({ item_id: 'valle/a' })
  expect(await listOutbox()).toEqual([])
})

test('replays a check_set unset as a delete filtered on item_id', async () => {
  const calls: Call[] = []
  await enqueue({ key: 'check:valle/a', kind: 'check_set', payload: { itemId: 'valle/a', done: false } })
  await flushOutbox(fakeClient(calls), soon(), () => true)
  expect(calls[0].op).toBe('delete')
  expect(calls[0].filters).toEqual([['item_id', 'valle/a']])
})

test('a duplicate-key error on a check insert counts as success', async () => {
  const calls: Call[] = []
  await enqueue({ key: 'check:valle/a', kind: 'check_set', payload: { itemId: 'valle/a', done: true } })
  const client = fakeClient(calls, () => ({ message: 'duplicate key value violates unique constraint', code: '23505' }))
  const res = await flushOutbox(client, soon(), () => true)
  expect(res.done).toBe(1)
  expect(await listOutbox()).toEqual([])
})

test('replays booking_state and day_notes as upserts with their conflict targets', async () => {
  const calls: Call[] = []
  const booking = await enqueue({ key: 'booking:valle:b1', kind: 'booking_state', payload: { trip: 'valle', booking_id: 'b1', confirmed: true, updated_at: '2026-09-15T10:00:00.000Z' } })
  const notes = await enqueue({ key: 'notes:valle:2026-09-20:text', kind: 'day_notes', payload: { trip: 'valle', date: '2026-09-20', patch: { text: 'hello' } } })
  const typedAt = 1_700_000_000_000
  await updateOp(booking.id, { createdAt: typedAt - 5, nextAt: 0 })
  await updateOp(notes.id, { createdAt: typedAt, nextAt: 0 })

  await flushOutbox(fakeClient(calls), typedAt + 1000, () => true)
  expect(calls[0].table).toBe('booking_state')
  expect(calls[0].upsertOpts).toEqual({ onConflict: 'trip,booking_id' })
  expect(calls[0].payload).toEqual({ trip: 'valle', booking_id: 'b1', confirmed: true, updated_at: '2026-09-15T10:00:00.000Z' })
  expect(calls[1].table).toBe('day_notes')
  expect(calls[1].upsertOpts).toEqual({ onConflict: 'trip,date' })
  // The note carries the time it was typed, not the time signal came back.
  expect(calls[1].payload).toEqual({ trip: 'valle', date: '2026-09-20', text: 'hello', updated_at: new Date(typedAt).toISOString() })
})

test('replays an attachment_upload as a storage upload then a row insert, with the stored Blob', async () => {
  const calls: Call[] = []
  const blob = new Blob(['ticket bytes'], { type: 'application/pdf' })
  await enqueue({
    key: 'own/valle/b1/t.pdf', kind: 'attachment_upload',
    payload: { trip: 'valle', bookingId: 'b1', ownerId: 'own', path: 'own/valle/b1/t.pdf', filename: 't.pdf', mime: 'application/pdf', size: blob.size, blob },
  })
  const res = await flushOutbox(fakeClient(calls), soon(), () => true)
  expect(res.done).toBe(1)
  expect(calls).toHaveLength(2)
  expect(calls[0]).toMatchObject({ op: 'upload', bucket: 'tickets', path: 'own/valle/b1/t.pdf', body: 'ticket bytes' })
  expect(calls[0].payload).toEqual({ contentType: 'application/pdf', upsert: false })
  expect(calls[1]).toMatchObject({ op: 'insert', table: 'attachments' })
  expect(calls[1].payload).toEqual({ trip: 'valle', booking_id: 'b1', storage_path: 'own/valle/b1/t.pdf', filename: 't.pdf', mime: 'application/pdf', size: blob.size })
})

test('processes ops FIFO by createdAt', async () => {
  const calls: Call[] = []
  const a = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  const b = await enqueue({ key: 'check:b', kind: 'check_set', payload: { itemId: 'b', done: true } })
  const c = await enqueue({ key: 'check:c', kind: 'check_set', payload: { itemId: 'c', done: true } })
  await updateOp(a.id, { createdAt: 300, nextAt: 300 })
  await updateOp(b.id, { createdAt: 100, nextAt: 100 })
  await updateOp(c.id, { createdAt: 200, nextAt: 200 })
  await flushOutbox(fakeClient(calls), 1000, () => true)
  expect(calls.map(x => (x.payload as { item_id: string }).item_id)).toEqual(['b', 'c', 'a'])
})

test('backs off 4 s then 8 s and succeeds on the third attempt', async () => {
  const calls: Call[] = []
  const client = fakeClient(calls, failNTimes(2))
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, nextAt: 0 })

  const first = await flushOutbox(client, 1000, () => true)
  expect(first).toEqual({ done: 0, remaining: 1, failed: 0 })
  let stored = (await listOutbox())[0]
  expect(stored.attempts).toBe(1)
  expect(stored.nextAt).toBe(1000 + 4000)
  expect(stored.lastError).toBe('network down')

  // Not due yet: no second call.
  const skipped = await flushOutbox(client, 2000, () => true)
  expect(skipped).toEqual({ done: 0, remaining: 1, failed: 0 })
  expect(calls).toHaveLength(1)

  await flushOutbox(client, 5000, () => true)
  stored = (await listOutbox())[0]
  expect(stored.attempts).toBe(2)
  expect(stored.nextAt).toBe(5000 + 8000)
  expect(calls).toHaveLength(2)

  const last = await flushOutbox(client, 13_000, () => true)
  expect(last).toEqual({ done: 1, remaining: 0, failed: 0 })
  expect(calls).toHaveLength(3)
  expect(await listOutbox()).toEqual([])
})

test('caps the backoff at five minutes', async () => {
  const calls: Call[] = []
  const client = fakeClient(calls, () => ({ message: 'nope' }))
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, attempts: 10, nextAt: 0 })
  await flushOutbox(client, 1000, () => true)
  expect((await listOutbox())[0].nextAt).toBe(1000 + 300_000)
})

test('marks an op failed after 20 attempts, keeps it, and skips it on later flushes', async () => {
  const calls: Call[] = []
  const client = fakeClient(calls, () => ({ message: 'still down' }))
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, attempts: 19, nextAt: 0 })

  const res = await flushOutbox(client, 1000, () => true)
  expect(res).toEqual({ done: 0, remaining: 0, failed: 1 })
  const stored = (await listOutbox())[0]
  expect(stored.attempts).toBe(20)
  expect(stored.status).toBe('failed')

  const later = await flushOutbox(client, 10_000_000, () => true)
  expect(calls).toHaveLength(1)
  expect(later).toEqual({ done: 0, remaining: 0, failed: 1 })
})

test('retryFailed resets failed ops and re-runs them', async () => {
  const calls: Call[] = []
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, attempts: 20, status: 'failed', nextAt: 9_999_999, lastError: 'still down' })

  const res = await retryFailed(fakeClient(calls), 1000, () => true)
  expect(res).toEqual({ done: 1, remaining: 0, failed: 0 })
  expect(calls).toHaveLength(1)
  expect(await listOutbox()).toEqual([])
})

test('retryFailed clears attempts and status even when the replay fails again', async () => {
  const calls: Call[] = []
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, attempts: 20, status: 'failed', nextAt: 9_999_999 })
  await retryFailed(fakeClient(calls, () => ({ message: 'down again' })), 1000, () => true)
  const stored = (await listOutbox())[0]
  expect(stored.status).toBe('pending')
  expect(stored.attempts).toBe(1)
  expect(stored.nextAt).toBe(1000 + 4000)
})

test('flushOutbox returns immediately when offline', async () => {
  const calls: Call[] = []
  await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await enqueue({ key: 'check:b', kind: 'check_set', payload: { itemId: 'b', done: true } })
  const res = await flushOutbox(fakeClient(calls), soon(), () => false)
  expect(res).toEqual({ done: 0, remaining: 2, failed: 0 })
  expect(calls).toEqual([])
  expect(await listOutbox()).toHaveLength(2)
})

test('flushOutbox falls back to navigator.onLine', async () => {
  const calls: Call[] = []
  const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  expect(await flushOutbox(fakeClient(calls), soon())).toEqual({ done: 0, remaining: 1, failed: 0 })
  expect(calls).toEqual([])
  spy.mockRestore()
})

test('startSync flushes on online, on foreground and on the 60 s interval, and stop() unwires everything', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const calls: Call[] = []
  const client = fakeClient(calls)
  const stop = startSync(client)

  await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  window.dispatchEvent(new Event('online'))
  await until(() => calls.length === 1)

  await enqueue({ key: 'check:b', kind: 'check_set', payload: { itemId: 'b', done: true } })
  document.dispatchEvent(new Event('visibilitychange'))
  await until(() => calls.length === 2)

  await enqueue({ key: 'check:c', kind: 'check_set', payload: { itemId: 'c', done: true } })
  vi.advanceTimersByTime(60_000)
  await until(() => calls.length === 3)

  stop()
  await enqueue({ key: 'check:d', kind: 'check_set', payload: { itemId: 'd', done: true } })
  window.dispatchEvent(new Event('online'))
  document.dispatchEvent(new Event('visibilitychange'))
  vi.advanceTimersByTime(180_000)
  await new Promise(r => setTimeout(r, 30))
  expect(calls).toHaveLength(3)
  expect(await listOutbox()).toHaveLength(1)
})

test('useSync reports the outbox counts and refreshes on notify', async () => {
  const calls: Call[] = []
  const client = fakeClient(calls)
  const { result } = renderHook(() => useSync(client))
  await waitFor(() => expect(result.current.pending).toBe(0))

  const a = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await enqueue({ key: 'check:b', kind: 'check_set', payload: { itemId: 'b', done: true } })
  await updateOp(a.id, { status: 'failed', attempts: 20, lastError: 'gave up' })
  notify()
  await waitFor(() => expect(result.current).toMatchObject({ pending: 1, failed: 1, syncing: false }))

  await result.current.retryFailed()
  await waitFor(() => expect(result.current).toMatchObject({ pending: 0, failed: 0 }))
  expect(await listOutbox()).toEqual([])
})

/** Every freshly enqueued op is due at its createdAt, so flushes in these tests run "a moment from now". */
function soon() { return Date.now() + 1000 }

/** Poll on real timers; fake-indexeddb settles on macrotasks, so microtask flushing is not enough. */
async function until(fn: () => boolean, ms = 1000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition')
    await new Promise(r => setTimeout(r, 5))
  }
}
