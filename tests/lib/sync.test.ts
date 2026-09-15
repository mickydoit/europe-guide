import '../helpers/blobClone'
import { renderHook, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resetDbForTests } from '../../src/lib/db'
import { enqueue, listOutbox, updateOp, countOutbox } from '../../src/lib/outbox'
import { flushOutbox, retryFailed, startSync, useSync, notify, resetSyncForTests, MAX_ATTEMPTS, MAX_NETWORK_HOLDS, OFFLINE_TOO_LONG } from '../../src/lib/sync'

type Err = { message: string; code?: string } | null
type Call = { op: string; table?: string; bucket?: string; path?: string; payload?: unknown; filters?: Array<[string, unknown]>; upsertOpts?: unknown; body?: string }

type ClientOpts = {
  /** Fails storage uploads independently of table calls. */
  storageFail?: () => Err
  /** Holds every table call open until it resolves, so two flushes can overlap in a test. */
  gate?: Promise<unknown>
}

/** A Supabase stand-in that records every call and can be told to fail the first N of them. */
function fakeClient(calls: Call[], fail: () => Err = () => null, opts: ClientOpts = {}) {
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
        const finish = () => {
          const error = fail()
          resolve({ data: error ? null : payload, error })
        }
        if (opts.gate) void opts.gate.then(finish, finish)
        else finish()
      },
    }
    return q
  }
  const storage = {
    from(bucket: string) {
      return {
        async upload(path: string, blob: Blob, uploadOpts: unknown) {
          calls.push({ op: 'upload', bucket, path, payload: uploadOpts, body: await blob.text() })
          const error = (opts.storageFail ?? fail)()
          return { data: error ? null : { path }, error }
        },
      }
    },
  }
  return { from, storage } as unknown as SupabaseClient
}

// Deliberately NOT a network-class message: the backoff ladder only applies to errors the
// server actually returned. A "no signal" failure holds the whole pass instead (see the
// network-class tests below), so a fixture saying "network down" would exercise that path.
function failNTimes(n: number, err: Err = { message: 'server refused' }) {
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
  expect(calls[0].payload).toEqual({ contentType: 'application/pdf', upsert: true })
  expect(calls[1]).toMatchObject({ op: 'insert', table: 'attachments' })
  expect(calls[1].payload).toEqual({ trip: 'valle', booking_id: 'b1', storage_path: 'own/valle/b1/t.pdf', filename: 't.pdf', mime: 'application/pdf', size: blob.size })
})

test('an attachment whose object already landed still inserts its row', async () => {
  const calls: Call[] = []
  const blob = new Blob(['ticket bytes'], { type: 'application/pdf' })
  await enqueue({
    key: 'own/valle/b1/t.pdf', kind: 'attachment_upload',
    payload: { trip: 'valle', bookingId: 'b1', ownerId: 'own', path: 'own/valle/b1/t.pdf', filename: 't.pdf', mime: 'application/pdf', size: blob.size, blob },
  })
  // A previous attempt uploaded the object and then died before the row insert.
  const client = fakeClient(calls, () => null, { storageFail: () => ({ message: 'The resource already exists', code: '409' }) })
  const res = await flushOutbox(client, soon(), () => true)
  expect(res.done).toBe(1)
  expect(calls.map(c => c.op)).toEqual(['upload', 'insert'])
  expect(await listOutbox()).toEqual([])
})

test('a duplicate-key on the attachments insert counts as success', async () => {
  const calls: Call[] = []
  const blob = new Blob(['ticket bytes'], { type: 'application/pdf' })
  await enqueue({
    key: 'own/valle/b1/t.pdf', kind: 'attachment_upload',
    payload: { trip: 'valle', bookingId: 'b1', ownerId: 'own', path: 'own/valle/b1/t.pdf', filename: 't.pdf', mime: 'application/pdf', size: blob.size, blob },
  })
  const client = fakeClient(calls, () => ({ message: 'duplicate key value violates unique constraint', code: '23505' }), { storageFail: () => null })
  const res = await flushOutbox(client, soon(), () => true)
  expect(res.done).toBe(1)
  expect(await listOutbox()).toEqual([])
})

test('a second flush while one is in flight is skipped, and the queue still drains', async () => {
  const calls: Call[] = []
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const client = fakeClient(calls, () => null, { gate })
  const a = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  const b = await enqueue({ key: 'check:b', kind: 'check_set', payload: { itemId: 'b', done: true } })
  await updateOp(a.id, { createdAt: 100, nextAt: 100 })
  await updateOp(b.id, { createdAt: 200, nextAt: 200 })

  const inFlight = flushOutbox(client, 1000, () => true)
  await until(() => calls.length === 1)

  const second = await flushOutbox(client, 1000, () => true)
  expect(second).toEqual({ done: 0, remaining: 2, failed: 0, skipped: true })
  expect(calls).toHaveLength(1)

  release()
  expect(await inFlight).toEqual({ done: 2, remaining: 0, failed: 0 })
  expect(calls.map(c => (c.payload as { item_id: string }).item_id)).toEqual(['a', 'b'])
  expect(await listOutbox()).toEqual([])
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
  expect(stored.lastError).toBe('server refused')

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

// ---- network-class failures (fix I1) ---------------------------------------

/** A client with no signal at all: every call throws the transport's own TypeError. */
function offlineClient() {
  return {
    from() { throw new TypeError('Failed to fetch') },
    storage: { from() { throw new TypeError('Failed to fetch') } },
  } as unknown as SupabaseClient
}

test('a network-class failure charges no attempt and holds the rest of the pass', async () => {
  const a = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  const b = await enqueue({ key: 'check:b', kind: 'check_set', payload: { itemId: 'b', done: true } })
  await updateOp(a.id, { createdAt: 100, nextAt: 100 })
  await updateOp(b.id, { createdAt: 200, nextAt: 200 })

  // `online()` says yes — this is the case where the phone thinks it has signal and doesn't.
  const res = await flushOutbox(offlineClient(), 1000, () => true)

  expect(res).toEqual({ done: 0, remaining: 2, failed: 0 })
  const [first, second] = await listOutbox()
  // Not the op's fault: it stays pending with nothing charged against MAX_ATTEMPTS.
  expect(first.attempts).toBe(0)
  expect(first.status).toBe('pending')
  expect(first.nextAt).toBe(1000 + 30_000)
  // The pass broke out rather than failing every later op for the same missing network.
  expect(second.attempts).toBe(0)
  expect(second.nextAt).toBe(200)
  expect(second.lastError).toBeUndefined()
})

test('a network-class failure never parks an op as failed, however often it is flushed', async () => {
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, nextAt: 0 })
  const client = offlineClient()
  for (let i = 0; i < MAX_ATTEMPTS + 5; i++) await flushOutbox(client, i * 60_000, () => true)
  const [stored] = await listOutbox()
  expect(stored.attempts).toBe(0)
  expect(stored.status).toBe('pending')
})

test('a server-class failure still backs off, even in the same pass shape', async () => {
  const calls: Call[] = []
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, nextAt: 0 })
  await flushOutbox(fakeClient(calls, () => ({ message: 'permission denied' })), 1000, () => true)
  const [stored] = await listOutbox()
  expect(stored.attempts).toBe(1)
  expect(stored.nextAt).toBe(1000 + 4000)
})

test('startSync flushes once immediately, without waiting for an event', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const calls: Call[] = []
  await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  const stop = startSync(fakeClient(calls))
  await until(() => calls.length === 1)
  stop()
  expect(await listOutbox()).toHaveLength(0)
})

// ---- the queue must not wedge behind one bad op ----------------------------

/** A client whose replay blows up on the op's own shape, not on the network. */
function brokenOpClient() {
  return {
    from() { throw new TypeError("Cannot read properties of null (reading 'itemId')") },
    storage: { from() { throw new TypeError('Cannot read properties of null') } },
  } as unknown as SupabaseClient
}

test('a TypeError that is not a transport failure is an ordinary failure, not a hold', async () => {
  const a = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  const b = await enqueue({ key: 'check:b', kind: 'check_set', payload: { itemId: 'b', done: true } })
  await updateOp(a.id, { createdAt: 100, nextAt: 100 })
  await updateOp(b.id, { createdAt: 200, nextAt: 200 })

  await flushOutbox(brokenOpClient(), 1000, () => true)

  const [first, second] = await listOutbox()
  expect(first.attempts).toBe(1)
  expect(first.nextAt).toBe(1000 + 4000)
  // No break: the pass carried on to the op behind it.
  expect(second.attempts).toBe(1)
})

test('a transport TypeError still holds the op without charging an attempt', async () => {
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, nextAt: 0 })

  await flushOutbox(offlineClient(), 1000, () => true)

  const [stored] = await listOutbox()
  expect(stored.attempts).toBe(0)
  expect(stored.networkHolds).toBe(1)
  expect(stored.nextAt).toBe(1000 + 30_000)
})

test('after MAX_NETWORK_HOLDS the op parks with something the owner can act on', async () => {
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, nextAt: 0 })
  const client = offlineClient()

  // Each hold pushes nextAt 30 s out, so a pass per 30 s is exactly the real cadence.
  for (let i = 1; i <= MAX_NETWORK_HOLDS; i++) {
    const res = await flushOutbox(client, i * 30_000, () => true)
    if (i < MAX_NETWORK_HOLDS) expect(res.failed).toBe(0)
  }

  const [stored] = await listOutbox()
  expect(stored.status).toBe('failed')
  expect(stored.lastError).toBe(OFFLINE_TOO_LONG)
  expect(stored.attempts).toBe(0)
  expect(await countOutbox()).toEqual({ pending: 0, failed: 1 })
})

test('a run of network holds is forgotten once the server answers', async () => {
  const calls: Call[] = []
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, nextAt: 0 })

  await flushOutbox(offlineClient(), 1000, () => true)
  expect((await listOutbox())[0].networkHolds).toBe(1)

  await flushOutbox(fakeClient(calls, () => ({ message: 'permission denied' })), 31_000, () => true)
  const [stored] = await listOutbox()
  expect(stored.networkHolds).toBe(0)
  expect(stored.attempts).toBe(1)
})

test('retryFailed clears the network holds along with the attempts', async () => {
  const calls: Call[] = []
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, nextAt: 0, status: 'failed', networkHolds: MAX_NETWORK_HOLDS - 1, lastError: OFFLINE_TOO_LONG })

  await retryFailed(fakeClient(calls), 1000, () => true)

  expect(await listOutbox()).toEqual([])
  expect(calls).toHaveLength(1)
})

test('replay keeps the error status, so a 503 from the server reads as no signal', async () => {
  const op = await enqueue({ key: 'check:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await updateOp(op.id, { createdAt: 0, nextAt: 0 })
  // A gateway error arrives as a PostgREST `{ error }`, not a thrown TypeError: without the
  // status riding along on the rethrow, the flush would charge the op for the gateway's fault.
  const gateway = fakeClient([], () => ({ message: 'gateway', status: 503 } as never))

  await flushOutbox(gateway, 1000, () => true)

  const [stored] = await listOutbox()
  expect(stored.attempts).toBe(0)
  expect(stored.networkHolds).toBe(1)
  expect(stored.nextAt).toBe(1000 + 30_000)
})
