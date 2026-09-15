import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { countOutbox, listOutbox, removeOp, updateOp } from './outbox'
import type { AttachmentUploadPayload, CheckSetPayload, DayNotesPayload, OutboxOp } from './outbox'

/** Give up flushing an op after this many failures; it is kept and shown with a Retry. */
export const MAX_ATTEMPTS = 20
const BACKOFF_CAP_MS = 300_000
const BASE_BACKOFF_MS = 2000
const SYNC_INTERVAL_MS = 60_000
/** Postgres `unique_violation` — the row is already there, which is exactly what we wanted. */
const DUPLICATE_KEY = '23505'

type PgError = { message?: string; code?: string } | null
type FlushResult = { done: number; remaining: number; failed: number }

function message(e: unknown) {
  const m = (e as { message?: unknown } | null)?.message
  return typeof m === 'string' && m ? m : String(e)
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
    // `updated_at` is the time the owner typed it, not the time we got signal back.
    const row = { trip, date, ...patch, updated_at: new Date(op.createdAt).toISOString() }
    const { error } = (await client.from('day_notes').upsert(row, { onConflict: 'trip,date' })) as { error: PgError }
    if (error) throw new Error(message(error))
    return
  }

  const a = op.payload as AttachmentUploadPayload
  const { error: upErr } = await client.storage.from('tickets').upload(a.path, a.blob, { contentType: a.mime, upsert: false })
  if (upErr) throw new Error(message(upErr))
  const { error: insErr } = (await client.from('attachments')
    .insert({ trip: a.trip, booking_id: a.bookingId, storage_path: a.path, filename: a.filename, mime: a.mime, size: a.size })) as { error: PgError }
  if (insErr) throw new Error(message(insErr))
}

// ---- flush ----------------------------------------------------------------

/**
 * Replay every due op in FIFO order. A failure backs the op off exponentially
 * (capped at five minutes) and, past MAX_ATTEMPTS, parks it as `failed` — stored,
 * never dropped. Returns the counts left behind.
 */
export async function flushOutbox(
  client: SupabaseClient = supabase,
  now: number = Date.now(),
  online: () => boolean = () => navigator.onLine,
): Promise<FlushResult> {
  if (!online()) {
    const { pending, failed } = await countOutbox()
    return { done: 0, remaining: pending, failed }
  }

  flushing = true
  notify()
  let done = 0
  try {
    for (const op of await listOutbox()) {
      if (!online()) break
      if (op.status !== 'pending' || op.nextAt > now) continue
      try {
        await replay(client, op)
        await removeOp(op.id)
        done += 1
        lastErrorMessage = undefined
      } catch (e) {
        const attempts = op.attempts + 1
        lastErrorMessage = message(e)
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
  const run = () => {
    if (flushing) return
    void flushOutbox(client).catch(e => { lastErrorMessage = message(e); notify() })
  }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  const timer = setInterval(run, SYNC_INTERVAL_MS)
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
