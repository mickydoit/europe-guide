import '../helpers/blobClone'
import { resetDbForTests } from '../../src/lib/db'
import { enqueue, listOutbox, removeOp, updateOp, countOutbox, clearOutboxForTests } from '../../src/lib/outbox'

async function wipe() {
  await resetDbForTests()
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase('europe-guide')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

beforeEach(wipe)

test('enqueue assigns id, createdAt, attempts, nextAt and status', async () => {
  const before = Date.now()
  const op = await enqueue({ key: 'check:valle/a', kind: 'check_set', payload: { itemId: 'valle/a', done: true } })
  expect(op.id).toBeTruthy()
  expect(typeof op.id).toBe('string')
  expect(op.createdAt).toBeGreaterThanOrEqual(before)
  expect(op.attempts).toBe(0)
  expect(op.nextAt).toBe(op.createdAt)
  expect(op.status).toBe('pending')
  expect(await listOutbox()).toHaveLength(1)
})

test('enqueue survives a missing crypto.randomUUID', async () => {
  const original = globalThis.crypto.randomUUID
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true, writable: true })
  try {
    const op = await enqueue({ key: 'check:x', kind: 'check_set', payload: { itemId: 'x', done: true } })
    expect(op.id).toMatch(/^\d+-/)
  } finally {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true, writable: true })
  }
})

test('last write wins: a newer op replaces the older one with the same key', async () => {
  const first = await enqueue({ key: 'check:valle/a', kind: 'check_set', payload: { itemId: 'valle/a', done: true } })
  const second = await enqueue({ key: 'check:valle/a', kind: 'check_set', payload: { itemId: 'valle/a', done: false } })
  const all = await listOutbox()
  expect(all).toHaveLength(1)
  expect(all[0].id).toBe(second.id)
  expect(all[0].id).not.toBe(first.id)
  expect((all[0].payload as { done: boolean }).done).toBe(false)
})

test('last write wins does not collapse attachment_upload ops', async () => {
  const blob = new Blob(['one'], { type: 'application/pdf' })
  await enqueue({ key: 'o/valle/b/1.pdf', kind: 'attachment_upload', payload: { trip: 'valle', bookingId: 'b', ownerId: 'o', path: 'o/valle/b/1.pdf', filename: '1.pdf', mime: 'application/pdf', size: 3, blob } })
  await enqueue({ key: 'o/valle/b/1.pdf', kind: 'attachment_upload', payload: { trip: 'valle', bookingId: 'b', ownerId: 'o', path: 'o/valle/b/1.pdf', filename: '1.pdf', mime: 'application/pdf', size: 3, blob } })
  expect(await listOutbox()).toHaveLength(2)
})

test('listOutbox is sorted by createdAt', async () => {
  const a = await enqueue({ key: 'k:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  const b = await enqueue({ key: 'k:b', kind: 'check_set', payload: { itemId: 'b', done: true } })
  const c = await enqueue({ key: 'k:c', kind: 'check_set', payload: { itemId: 'c', done: true } })
  // Explicit, distinct timestamps in a different order from insertion prove the sort is real.
  await updateOp(a.id, { createdAt: 300 })
  await updateOp(b.id, { createdAt: 100 })
  await updateOp(c.id, { createdAt: 200 })
  expect((await listOutbox()).map(o => o.id)).toEqual([b.id, c.id, a.id])
})

test('removeOp deletes one op and updateOp patches it', async () => {
  const a = await enqueue({ key: 'k:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  const b = await enqueue({ key: 'k:b', kind: 'check_set', payload: { itemId: 'b', done: true } })
  await updateOp(a.id, { attempts: 3, lastError: 'boom' })
  const patched = (await listOutbox()).find(o => o.id === a.id)
  expect(patched?.attempts).toBe(3)
  expect(patched?.lastError).toBe('boom')
  await removeOp(b.id)
  expect((await listOutbox()).map(o => o.id)).toEqual([a.id])
})

test('countOutbox splits pending from failed', async () => {
  const a = await enqueue({ key: 'k:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await enqueue({ key: 'k:b', kind: 'check_set', payload: { itemId: 'b', done: true } })
  expect(await countOutbox()).toEqual({ pending: 2, failed: 0 })
  await updateOp(a.id, { status: 'failed' })
  expect(await countOutbox()).toEqual({ pending: 1, failed: 1 })
})

test('a Blob payload round-trips through IndexedDB', async () => {
  const blob = new Blob(['hello pdf'], { type: 'application/pdf' })
  await enqueue({ key: 'o/valle/b/t.pdf', kind: 'attachment_upload', payload: { trip: 'valle', bookingId: 'b', ownerId: 'o', path: 'o/valle/b/t.pdf', filename: 't.pdf', mime: 'application/pdf', size: blob.size, blob } })
  const [op] = await listOutbox()
  const stored = (op.payload as { blob: Blob }).blob
  expect(stored).toBeInstanceOf(Blob)
  expect(await stored.text()).toBe('hello pdf')
})

test('clearOutboxForTests empties the store', async () => {
  await enqueue({ key: 'k:a', kind: 'check_set', payload: { itemId: 'a', done: true } })
  await clearOutboxForTests()
  expect(await listOutbox()).toEqual([])
})
