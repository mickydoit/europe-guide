import { countOutboxByStatus, getOutbox, getOutboxAll, getOutboxByKey, getOutboxDue, getOutboxIdsByKey, putOutbox, deleteOutbox, clearOutbox } from './db'

/**
 * A write the app made that the server has not accepted yet.
 *
 * Every field is structured-cloneable so the whole op — including an attachment's
 * `Blob` — survives a reload in IndexedDB. Ops are never dropped: after
 * `MAX_ATTEMPTS` failures the status flips to `failed` and it waits for a Retry.
 */
export type OutboxOp = {
  id: string
  /** Dedupe key. A newer op for the same key replaces the older one (last write wins). */
  key: string
  kind: 'check_set' | 'booking_state' | 'day_notes' | 'attachment_upload'
  payload: unknown
  createdAt: number
  attempts: number
  /** Earliest time this op may be replayed again (backoff schedule). */
  nextAt: number
  status: 'pending' | 'failed'
  lastError?: string
}

export type CheckSetPayload = { itemId: string; done: boolean }
/** The whole `booking_state` upsert row, exactly as `useBookingState.save` sends it. */
export type BookingStatePayload = { trip: string; booking_id: string; updated_at: string; [key: string]: unknown }
export type DayNotesPayload = { trip: string; date: string; patch: { text?: string; saved_places?: unknown[] } }
export type AttachmentUploadPayload = {
  trip: string
  bookingId: string
  ownerId: string
  path: string
  filename: string
  mime: string
  size: number
  blob: Blob
}

/** Ops that are unique by construction (one per storage path) and so must never collapse by key. */
const UNIQUE_KINDS: ReadonlySet<OutboxOp['kind']> = new Set(['attachment_upload'])

function newId() {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

/**
 * Queue a write. For every kind but `attachment_upload` this replaces any op already
 * queued under the same key, so the outbox holds the latest intent rather than a
 * replay of every toggle the owner made while offline.
 */
export async function enqueue(partial: Pick<OutboxOp, 'key' | 'kind' | 'payload'>): Promise<OutboxOp> {
  if (!UNIQUE_KINDS.has(partial.kind)) {
    for (const id of await getOutboxIdsByKey(partial.key)) await deleteOutbox(id)
  }
  const createdAt = Date.now()
  const op: OutboxOp = { id: newId(), key: partial.key, kind: partial.kind, payload: partial.payload, createdAt, attempts: 0, nextAt: createdAt, status: 'pending' }
  await putOutbox(op)
  return op
}

/** Every queued op, oldest first — the order they are replayed in. */
export async function listOutbox(): Promise<OutboxOp[]> {
  return (await getOutboxAll()).sort((a, b) => a.createdAt - b.createdAt)
}

/** Pending ops whose backoff has elapsed, oldest first — exactly what a flush should replay. */
export async function listDueOps(now: number): Promise<OutboxOp[]> {
  return (await getOutboxDue(now)).filter(o => o.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)
}

export async function removeOp(id: string) {
  await deleteOutbox(id)
}

/** The ops queued under one key, oldest first — `createdAt` and all. */
export async function listOpsByKey(key: string): Promise<OutboxOp[]> {
  return (await getOutboxByKey(key)).sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * Drop every op queued under one key and say how many went.
 *
 * Used when a live write has just landed for that key: the queued op is older intent and
 * replaying it would undo what the server has already accepted.
 */
export async function removeOpsByKey(key: string): Promise<number> {
  const ids = await getOutboxIdsByKey(key)
  for (const id of ids) await deleteOutbox(id)
  return ids.length
}

export async function updateOp(id: string, patch: Partial<OutboxOp>) {
  const current = await getOutbox(id)
  if (!current) return null
  const next: OutboxOp = { ...current, ...patch, id: current.id }
  await putOutbox(next)
  return next
}

/** Counted in the `status` index: an attachment op's Blob is never read just to draw a badge. */
export async function countOutbox(): Promise<{ pending: number; failed: number }> {
  const [pending, failed] = await Promise.all([countOutboxByStatus('pending'), countOutboxByStatus('failed')])
  return { pending, failed }
}

/** Test-only: empty the queue without touching the cached content stores. */
export async function clearOutboxForTests() {
  await clearOutbox()
}
