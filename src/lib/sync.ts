import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { countOutbox, listDueOps, listOutbox, removeOp, updateOp } from './outbox'
import type { AttachmentUploadPayload, CheckSetPayload, DayNotesPayload, OutboxOp } from './outbox'
import { isNetworkFailure } from './net'

/** Give up flushing an op after this many failures; it is kept and shown with a Retry. */
export const MAX_ATTEMPTS = 20
const BACKOFF_CAP_MS = 300_000
const BASE_BACKOFF_MS = 2000
const SYNC_INTERVAL_MS = 60_000
/** How long a whole pass waits after losing signal mid-flush. Not a per-op backoff. */
const NETWORK_RETRY_MS = 30_000
/** Postgres `unique_violation` — the row is already there, which is exactly what we wanted. */
const DUPLICATE_KEY = '23505'
/** Storage's several ways of saying "that object is already at that path". */
const ALREADY_EXISTS = /already exists|duplicate|409/i

type PgError = { message?: string; code?: string } | null
type FlushResult = { done: number; remaining: number; failed: number; skipped?: boolean }

function message(e: unknown) {
  const m = (e as { message?: unknown } | null)?.message
  return typeof m === 'string' && m ? m : String(e)
}

/** True when a storage upload failed only because the bytes are already at that path. */
function isAlreadyExists(e: unknown) {
  const err = e as { message?: unknown; statusCode?: unknown; status?: unknown; error?: unknown } | null
  return ALREADY_EXISTS.test([err?.message, err?.statusCode, err?.status, err?.error].map(v => (v == null ? '' : String(v))).join(' '))
}

function backoffFrom(now: number, attempts: number) {
  return now + Math.min(BACKOFF_CAP_MS, 2 ** attempts * BASE_BACKOFF_MS)
}

// ---- change emitter -------------------------------------------------------
// Anything that mutates the outbox calls notify() so every useSync() re-reads the counts.

const listeners = new Set<() => void>()
let flushing = false
let lastErrorMessage: string | undefined

export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function notify() {
  for (const fn of [...listeners]) fn()
}

/** Test-only: forget the in-module flush flag, last error and subscribers. */
export function resetSyncForTests() {
  listeners.clear()
  flushing = false
  lastErrorMessage = undefined
}

// ---- replay ---------------------------------------------------------------

/** Send one queued op to Supabase. Throws on anything the server did not accept. */
export async function replay(client: SupabaseClient, op: OutboxOp): Promise<void> {
  if (op.kind === 'check_set') {
    const { itemId, done } = op.payload as CheckSetPayload
    if (done) {
      const { error } = (await client.from('item_checks').insert({ item_id: itemId })) as { error: PgError }
      // The check is already recorded — an earlier attempt landed after all.
      if (error && error.code !== DUPLICATE_KEY) throw new Error(message(error))
    } else {
      const { error } = (await client.from('item_checks').delete().eq('item_id', itemId)) as { error: PgError }
      if (error) throw new Error(message(error))
    }
    return
  }

  if (op.kind === 'booking_state') {
    const { error } = (await client.from('booking_state').upsert(op.payload as Record<string, unknown>, { onConflict: 'trip,booking_id' })) as { error: PgError }
    if (error) throw new Error(message(error))
    return
  }

  if (op.kind === 'day_notes') {
    const { trip, date, patch } = op.payload as DayNotesPayload
    // `updated_at` comes from `op.createdAt` — the moment the owner typed it — not from the
    // moment signal came back. A note queued on Tuesday and flushed on Friday must not look
    // newer than an edit made from another device on Wednesday: last-write-wins is decided
    // on this column, so it has to carry the author's clock, not the network's.
    const row = { trip, date, ...patch, updated_at: new Date(op.createdAt).toISOString() }
    const { error } = (await client.from('day_notes').upsert(row, { onConflict: 'trip,date' })) as { error: PgError }
    if (error) throw new Error(message(error))
    return
  }

  const a = op.payload as AttachmentUploadPayload
  // Both halves must be safe to repeat: a retry after a half-finished attempt (object
  // uploaded, row insert failed) would otherwise wedge the op forever on "already exists".
  // Re-uploading the same bytes to the same path is harmless, so overwrite rather than refuse.
  const { error: upErr } = await client.storage.from('tickets').upload(a.path, a.blob, { contentType: a.mime, upsert: true })
  if (upErr && !isAlreadyExists(upErr)) throw new Error(message(upErr))
  const { error: insErr } = (await client.from('attachments')
    .insert({ trip: a.trip, booking_id: a.bookingId, storage_path: a.path, filename: a.filename, mime: a.mime, size: a.size })) as { error: PgError }
  if (insErr && insErr.code !== DUPLICATE_KEY) throw new Error(message(insErr))
}

// ---- flush ----------------------------------------------------------------

/**
 * Replay every due op in FIFO order. A failure backs the op off exponentially
 * (capped at five minutes) and, past MAX_ATTEMPTS, parks it as `failed` — stored,
 * never dropped. Returns the counts left behind; `skipped` marks a call that did
 * nothing because a flush was already in flight.
 */
export async function flushOutbox(
  client: SupabaseClient = supabase,
  now: number = Date.now(),
  online: () => boolean = () => navigator.onLine,
): Promise<FlushResult> {
  // One flush at a time: overlapping passes would replay the same op twice.
  if (flushing) {
    const { pending, failed } = await countOutbox()
    return { done: 0, remaining: pending, failed, skipped: true }
  }
  if (!online()) {
    const { pending, failed } = await countOutbox()
    return { done: 0, remaining: pending, failed }
  }

  flushing = true
  notify()
  let done = 0
  try {
    for (const op of await listDueOps(now)) {
      if (!online()) break
      try {
        await replay(client, op)
        await removeOp(op.id)
        done += 1
        lastErrorMessage = undefined
      } catch (e) {
        lastErrorMessage = message(e)
        // No signal is not the op's fault. Charging it an attempt would march a perfectly
        // good write towards `failed` for being queued through a long tunnel, and every
        // later op in this pass would fail identically — so hold the whole queue, not just
        // this one, and try the lot again in half a minute.
        if (isNetworkFailure(e)) {
          await updateOp(op.id, { nextAt: now + NETWORK_RETRY_MS, lastError: lastErrorMessage })
          break
        }
        const attempts = op.attempts + 1
        await updateOp(op.id, {
          attempts,
          nextAt: backoffFrom(now, attempts),
          lastError: lastErrorMessage,
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        })
      }
    }
  } finally {
    flushing = false
  }
  const { pending, failed } = await countOutbox()
  notify()
  return { done, remaining: pending, failed }
}

/** Un-park every `failed` op and flush again. */
export async function retryFailed(
  client: SupabaseClient = supabase,
  now: number = Date.now(),
  online: () => boolean = () => navigator.onLine,
): Promise<FlushResult> {
  for (const op of await listOutbox()) {
    if (op.status === 'failed') await updateOp(op.id, { attempts: 0, nextAt: now, status: 'pending', lastError: undefined })
  }
  lastErrorMessage = undefined
  notify()
  return flushOutbox(client, now, online)
}

/**
 * Wire the outbox to the things that mean "there might be signal now": coming back
 * online, bringing the app to the foreground, and a slow heartbeat. Returns a stop
 * function that removes every listener and the interval.
 */
export function startSync(client: SupabaseClient = supabase) {
  const run = () => { void flushOutbox(client).catch(e => { lastErrorMessage = message(e); notify() }) }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  const timer = setInterval(run, SYNC_INTERVAL_MS)
  // The queue may already hold writes from the last session; waiting a whole minute to find
  // that out is a minute of a stale "1 waiting" badge on a phone that plainly has signal.
  if (typeof navigator === 'undefined' || navigator.onLine !== false) run()
  return () => {
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(timer)
  }
}

// ---- hook -----------------------------------------------------------------

export type SyncStatus = { pending: number; failed: number; syncing: boolean; lastError?: string }

/** Live view of the outbox for the UI: counts, whether a flush is in flight, and a Retry. */
export function useSync(client: SupabaseClient = supabase) {
  const [status, setStatus] = useState<SyncStatus>({ pending: 0, failed: 0, syncing: false, lastError: undefined })

  useEffect(() => {
    let alive = true
    const refresh = () => {
      void countOutbox().then(c => { if (alive) setStatus({ ...c, syncing: flushing, lastError: lastErrorMessage }) })
    }
    refresh()
    const unsubscribe = subscribe(refresh)
    return () => { alive = false; unsubscribe() }
  }, [])

  const retry = useCallback(() => retryFailed(client), [client])
  return { ...status, retryFailed: retry }
}

/** The queued ops themselves, for the "Pending changes" list in More. */
export function useOutboxOps(): OutboxOp[] {
  const [ops, setOps] = useState<OutboxOp[]>([])

  useEffect(() => {
    let alive = true
    const refresh = () => {
      void listOutbox().then(o => { if (alive) setOps(o) }).catch(() => {})
    }
    refresh()
    const unsubscribe = subscribe(refresh)
    return () => { alive = false; unsubscribe() }
  }, [])

  return ops
}
