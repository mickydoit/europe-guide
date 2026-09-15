import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { enqueue, listOutbox, removeOp } from './outbox'
import type { AttachmentUploadPayload, BookingStatePayload, CheckSetPayload, DayNotesPayload } from './outbox'
import { flushOutbox, notify } from './sync'

export type BookingStatus = 'not_booked' | 'booked' | 'confirmed' | 'cancelled' | 'undecided'

export interface BookingStateRow {
  trip: string
  booking_id: string
  status: BookingStatus | null
  confirmation_ref: string | null
  cost: number | null
  currency: string | null
  notes: string | null
  updated_at: string
}

export interface AttachmentRow {
  id: string
  trip: string
  booking_id: string
  storage_path: string
  filename: string
  mime: string
  size: number
  uploaded_at: string
  /** Set on rows that only exist in the outbox: the file has not reached storage yet. */
  pendingUpload?: boolean
}

/** Every write resolves with this. `queued` means the outbox has it, not the server. */
export type WriteResult = { queued: boolean }

function message(e: { message: string } | null): string { return e?.message ?? 'unknown error' }

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

// Word-bounded on purpose: an unbounded /load failed/ also matches "upload failed", which is
// a perfectly ordinary storage rejection and must still surface as an error, not a queued write.
const NETWORK_MESSAGE = /\bfetch\b|\bnetwork\b|Failed to fetch|NetworkError|\bload failed\b/i
/** Gateway-class statuses: the request never reached Postgres, so replaying it is safe. */
const NETWORK_STATUS = new Set([0, 502, 503, 504])

/**
 * Did this failure mean "no signal" rather than "the server said no"?
 *
 * Supabase hands back fetch failures two different ways — a thrown `TypeError` from the
 * transport, or a `{ error }` object carrying the transport's message — so both shapes land here.
 */
function isNetworkFailure(e: unknown): boolean {
  if (e instanceof TypeError) return true
  const o = e as { message?: unknown; status?: unknown } | null
  if (o && typeof o.status === 'number' && NETWORK_STATUS.has(o.status)) return true
  const m = typeof o?.message === 'string' ? o.message : ''
  return NETWORK_MESSAGE.test(m)
}

type Failure = { ok: false; network: boolean; error: { message: string } }
type Success<T> = { ok: true; data: T }

/**
 * Run one Supabase write and classify the outcome. Callers decide what a network-class
 * failure means for their own optimistic state; nothing is queued or reverted in here.
 */
async function runWrite<T>(fn: () => PromiseLike<{ data?: T; error: unknown }>): Promise<Success<T | undefined> | Failure> {
  try {
    const { data, error } = await fn()
    if (!error) return { ok: true, data }
    return { ok: false, network: isNetworkFailure(error), error: { message: message(error as { message: string }) } }
  } catch (e) {
    return { ok: false, network: isNetworkFailure(e), error: { message: e instanceof Error ? e.message : String(e) } }
  }
}

/** Queue a write and wake every `useSync()`. `enqueue` deliberately does not notify itself. */
async function queue(op: Parameters<typeof enqueue>[0]): Promise<WriteResult> {
  await enqueue(op)
  notify()
  return { queued: true }
}

/** A write landed, so there is signal — drain anything older that is still waiting. */
function drain(client: SupabaseClient) {
  void flushOutbox(client).catch(() => {})
}

export function useChecks(trip: string, client: SupabaseClient = supabase) {
  const [done, setDone] = useState<Set<string>>(new Set())
  const doneRef = useRef<Set<string>>(done)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { data, error } = await client.from('item_checks').select('*').like('item_id', `${trip}/%`)
      if (cancelled) return
      if (error) { console.warn(message(error)); setLoading(false); return }
      const next = new Set(((data ?? []) as { item_id: string }[]).map(r => r.item_id))
      // Anything still in the outbox is newer than what the server just told us: the owner's
      // pending tick (or untick) wins until it has actually been accepted.
      for (const op of await listOutbox()) {
        if (op.kind !== 'check_set') continue
        const p = op.payload as CheckSetPayload
        if (!p.itemId.startsWith(`${trip}/`)) continue
        if (p.done) next.add(p.itemId); else next.delete(p.itemId)
      }
      if (cancelled) return
      doneRef.current = next
      setDone(next)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [trip, client])

  async function toggle(itemId: string): Promise<WriteResult> {
    const wasDone = doneRef.current.has(itemId)
    const next = new Set(doneRef.current)
    if (wasDone) next.delete(itemId); else next.add(itemId)
    doneRef.current = next
    setDone(next)

    const payload: CheckSetPayload = { itemId, done: !wasDone }
    const enqueueIt = () => queue({ key: `check:${itemId}`, kind: 'check_set', payload })
    // Offline is not an error worth a round trip: queue it and keep the tick.
    if (!isOnline()) return enqueueIt()

    const outcome = await runWrite(() => (wasDone
      ? client.from('item_checks').delete().eq('item_id', itemId)
      : client.from('item_checks').insert({ item_id: itemId })) as PromiseLike<{ error: unknown }>)
    if (outcome.ok) { drain(client); return { queued: false } }
    if (outcome.network) return enqueueIt()

    const reverted = new Set(doneRef.current)
    if (wasDone) reverted.add(itemId); else reverted.delete(itemId)
    doneRef.current = reverted
    setDone(reverted)
    console.warn(outcome.error.message)
    throw new Error(outcome.error.message)
  }

  return { done, loading, toggle }
}

export function useBookingState(trip: string, client: SupabaseClient = supabase) {
  const [state, setState] = useState<Record<string, BookingStateRow>>({})
  const stateRef = useRef<Record<string, BookingStateRow>>({})
  const [loading, setLoading] = useState(true)

  function commit(next: Record<string, BookingStateRow>) {
    stateRef.current = next
    setState(next)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { data, error } = await client.from('booking_state').select('*').eq('trip', trip)
      if (cancelled) return
      if (error) { console.warn(message(error)); setLoading(false); return }
      const map: Record<string, BookingStateRow> = {}
      for (const row of (data ?? []) as BookingStateRow[]) map[row.booking_id] = row
      // Merge rather than replace: a queued op only carries the fields the owner edited.
      for (const op of await listOutbox()) {
        if (op.kind !== 'booking_state') continue
        const p = op.payload as BookingStatePayload
        if (p.trip !== trip) continue
        map[p.booking_id] = { ...map[p.booking_id], ...p } as BookingStateRow
      }
      if (cancelled) return
      commit(map)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [trip, client])

  async function save(
    bookingId: string,
    patch: Partial<Omit<BookingStateRow, 'trip' | 'booking_id' | 'updated_at'>>,
  ): Promise<WriteResult> {
    const updated_at = new Date().toISOString()
    const row = { trip, booking_id: bookingId, ...patch, updated_at }
    const previous = stateRef.current
    commit({ ...previous, [bookingId]: { ...previous[bookingId], ...row } as BookingStateRow })

    const enqueueIt = () => queue({ key: `booking:${trip}:${bookingId}`, kind: 'booking_state', payload: row })
    if (!isOnline()) return enqueueIt()

    const outcome = await runWrite(() => client.from('booking_state').upsert(row, { onConflict: 'trip,booking_id' }) as PromiseLike<{ error: unknown }>)
    if (outcome.ok) { drain(client); return { queued: false } }
    if (outcome.network) return enqueueIt()

    commit(previous)
    console.warn(outcome.error.message)
    throw new Error(outcome.error.message)
  }

  return { state, loading, save }
}

export function useAttachments(trip: string, bookingId: string, ownerId: string, client: SupabaseClient = supabase) {
  const [list, setList] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { data, error: err } = await client.from('attachments').select('*').eq('trip', trip).eq('booking_id', bookingId).order('uploaded_at')
      if (cancelled) return
      if (err) { console.warn(message(err)); setError(message(err)); setLoading(false); return }
      const rows = (data ?? []) as AttachmentRow[]
      const paths = new Set(rows.map(r => r.storage_path))
      const pending = (await listOutbox())
        .filter(op => op.kind === 'attachment_upload')
        .map(op => op.payload as AttachmentUploadPayload)
        .filter(p => p.trip === trip && p.bookingId === bookingId && !paths.has(p.path))
        .map(pendingRow)
      if (cancelled) return
      setList([...rows, ...pending])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [trip, bookingId, client])

  /** The row shown for a file that is still only in the outbox. */
  function pendingRow(p: AttachmentUploadPayload): AttachmentRow {
    return {
      id: `pending:${p.path}`,
      trip: p.trip,
      booking_id: p.bookingId,
      storage_path: p.path,
      filename: p.filename,
      mime: p.mime,
      size: p.size,
      uploaded_at: new Date().toISOString(),
      pendingUpload: true,
    }
  }

  async function findPendingOp(a: AttachmentRow) {
    return (await listOutbox()).find(op => op.kind === 'attachment_upload' && op.key === a.storage_path) ?? null
  }

  async function upload(file: File): Promise<WriteResult> {
    const validType = file.type === 'application/pdf' || file.type.startsWith('image/')
    if (!validType || file.size > 25 * 1024 * 1024) {
      const msg = 'Only PDF or image files up to 25 MB'
      setError(msg)
      throw new Error(msg)
    }

    const safeName = `${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`
    const path = `${ownerId}/${trip}/${bookingId}/${safeName}`
    const payload: AttachmentUploadPayload = {
      trip, bookingId, ownerId, path, filename: file.name, mime: file.type, size: file.size, blob: file,
    }
    // The Blob rides along in IndexedDB, so the ticket survives a reload with no signal.
    const enqueueIt = async () => {
      const result = await queue({ key: path, kind: 'attachment_upload', payload })
      setList(prev => [...prev, pendingRow(payload)])
      setError(null)
      return result
    }
    if (!isOnline()) return enqueueIt()

    const up = await runWrite(() => client.storage.from('tickets').upload(path, file, { contentType: file.type, upsert: false }))
    if (!up.ok) {
      if (up.network) return enqueueIt()
      console.warn(up.error.message); setError(up.error.message); throw new Error(up.error.message)
    }

    const ins = await runWrite<AttachmentRow>(() => client.from('attachments')
      .insert({ trip, booking_id: bookingId, storage_path: path, filename: file.name, mime: file.type, size: file.size })
      .select().single() as PromiseLike<{ data?: AttachmentRow; error: unknown }>)
    if (!ins.ok) {
      if (ins.network) return enqueueIt()
      console.warn(ins.error.message); setError(ins.error.message); throw new Error(ins.error.message)
    }
    setList(prev => [...prev, ins.data as AttachmentRow])
    setError(null)
    drain(client)
    return { queued: false }
  }

  async function url(a: AttachmentRow) {
    if (a.pendingUpload) {
      const op = await findPendingOp(a)
      if (!op) throw new Error('That file is no longer queued')
      return URL.createObjectURL((op.payload as AttachmentUploadPayload).blob)
    }
    const { data, error: sErr } = await client.storage.from('tickets').createSignedUrl(a.storage_path, 3600)
    if (sErr) { console.warn(message(sErr)); throw new Error(message(sErr)) }
    return (data as { signedUrl: string }).signedUrl
  }

  async function remove(a: AttachmentRow) {
    // Nothing was ever uploaded, so deleting it means dropping the queued op.
    if (a.pendingUpload) {
      const op = await findPendingOp(a)
      if (op) { await removeOp(op.id); notify() }
      setList(prev => prev.filter(x => x.id !== a.id))
      return
    }
    const { error: rmErr } = await client.storage.from('tickets').remove([a.storage_path])
    if (rmErr) { console.warn(message(rmErr)); throw new Error(message(rmErr)) }
    const { error: delErr } = await client.from('attachments').delete().eq('id', a.id)
    if (delErr) { console.warn(message(delErr)); throw new Error(message(delErr)) }
    setList(prev => prev.filter(x => x.id !== a.id))
  }

  return { list, loading, upload, url, remove, error }
}

export interface SavedPlace { id: string; name: string; lat: number; lng: number; saved_at: string }

export interface DayNoteRow {
  trip: string
  date: string
  text: string | null
  saved_places: SavedPlace[] | null
  updated_at: string
}

const NOTE_DEBOUNCE_MS = 800

export function useDayNotes(trip: string, date: string, client: SupabaseClient = supabase) {
  const [note, setNoteState] = useState('')
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  const [loading, setLoading] = useState(true)
  const noteRef = useRef('')
  const placesRef = useRef<SavedPlace[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingNote = useRef<(() => Promise<unknown>) | null>(null)
  // Set as soon as the user edits this day, so a slow initial load cannot overwrite their work.
  // Tracked per field: an unsent note must not also suppress the server's saved places.
  const dirtyText = useRef(false)
  const dirtyPlaces = useRef(false)

  useEffect(() => {
    let cancelled = false
    dirtyText.current = false
    dirtyPlaces.current = false
    // Clear before the new load starts, not after it lands: otherwise the previous day's
    // note and saved places stay on screen for the length of a round trip and read as this
    // day's. `dirty*` were just reset, so nothing unsent is being discarded here.
    noteRef.current = ''
    placesRef.current = []
    setNoteState('')
    setSavedPlaces([])
    // Callers that don't have a day yet (the Map screen before the trip resolves) pass ''.
    // Querying on it returns nothing useful and still burns a round trip, so skip it and
    // keep the empty state until a real (trip, date) arrives.
    if (!trip || !date) { setLoading(false); return }
    setLoading(true)
    void (async () => {
      const { data, error } = await client.from('day_notes').select('*').eq('trip', trip).eq('date', date)
      if (cancelled) return
      if (error) { console.warn(message(error)); setLoading(false); return }
      const row = ((data ?? []) as DayNoteRow[])[0]
      let text = row?.text ?? ''
      let places = row?.saved_places ?? []
      // Per field, because the two are queued under separate keys and either may be pending.
      for (const op of await listOutbox()) {
        if (op.kind !== 'day_notes') continue
        const p = op.payload as DayNotesPayload
        if (p.trip !== trip || p.date !== date) continue
        if (typeof p.patch.text === 'string') text = p.patch.text
        if (p.patch.saved_places) places = p.patch.saved_places as SavedPlace[]
      }
      if (cancelled) return
      if (!dirtyText.current) {
        noteRef.current = text
        setNoteState(noteRef.current)
      }
      if (!dirtyPlaces.current) {
        placesRef.current = places
        setSavedPlaces(placesRef.current)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [trip, date, client])

  // The debounce timer outlives a single render: on unmount, or when the day changes,
  // flush whatever the user last typed rather than dropping it on the floor.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const flush = pendingNote.current
    pendingNote.current = null
    if (flush) void flush().catch(() => {})
  }, [trip, date])

  // Only ever send the columns being changed. `upsert` compiles to ON CONFLICT DO UPDATE SET
  // <provided columns>, so omitting `text` from a place write leaves the stored note intact —
  // which matters because noteRef is still '' until the initial load resolves.
  async function upsert(patch: { text: string } | { saved_places: SavedPlace[] }): Promise<WriteResult> {
    const field = 'text' in patch ? 'text' : 'saved_places'
    const enqueueIt = () => queue({
      key: `notes:${trip}:${date}:${field}`,
      kind: 'day_notes',
      payload: { trip, date, patch } satisfies DayNotesPayload,
    })
    if (!isOnline()) return enqueueIt()

    const row: Record<string, unknown> = { trip, date, ...patch, updated_at: new Date().toISOString() }
    const outcome = await runWrite(() => client.from('day_notes').upsert(row, { onConflict: 'trip,date' }) as PromiseLike<{ error: unknown }>)
    if (outcome.ok) { drain(client); return { queued: false } }
    if (outcome.network) return enqueueIt()
    console.warn(outcome.error.message)
    throw new Error(outcome.error.message)
  }

  function setNote(text: string) {
    // Stays set even if the save fails: unsent text is the user's, and losing it is worse
    // than showing a stale server note. It never gates saved_places.
    dirtyText.current = true
    noteRef.current = text
    setNoteState(text)
    if (timer.current) clearTimeout(timer.current)
    // Nothing awaits a debounced save, so the warn inside upsert is the whole report.
    const flush = () => upsert({ text })
    pendingNote.current = flush
    timer.current = setTimeout(() => {
      timer.current = null
      pendingNote.current = null
      void flush().catch(() => {})
    }, NOTE_DEBOUNCE_MS)
  }

  async function writePlaces(next: SavedPlace[]): Promise<WriteResult> {
    const previous = placesRef.current
    const wasDirty = dirtyPlaces.current
    dirtyPlaces.current = true
    placesRef.current = next
    setSavedPlaces(next)
    try {
      // A queued write returns normally: the list stands, the outbox owns the rest.
      return await upsert({ saved_places: next })
    } catch (e) {
      // The write is gone, so this list is no longer a local edit worth defending —
      // let a still-pending load replace it with server truth.
      dirtyPlaces.current = wasDirty
      placesRef.current = previous
      setSavedPlaces(previous)
      throw e
    }
  }

  async function savePlace(place: SavedPlace): Promise<WriteResult> {
    if (placesRef.current.some(p => p.id === place.id)) return { queued: false }
    return writePlaces([...placesRef.current, place])
  }

  async function removePlace(id: string): Promise<WriteResult> {
    if (!placesRef.current.some(p => p.id === id)) return { queued: false }
    return writePlaces(placesRef.current.filter(p => p.id !== id))
  }

  return { note, savedPlaces, loading, setNote, savePlace, removePlace }
}
