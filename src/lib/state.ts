import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

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
}

function message(e: { message: string } | null): string { return e?.message ?? 'unknown error' }

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
      doneRef.current = next
      setDone(next)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [trip, client])

  async function toggle(itemId: string) {
    const wasDone = doneRef.current.has(itemId)
    const next = new Set(doneRef.current)
    if (wasDone) next.delete(itemId); else next.add(itemId)
    doneRef.current = next
    setDone(next)
    const { error } = wasDone
      ? await client.from('item_checks').delete().eq('item_id', itemId)
      : await client.from('item_checks').insert({ item_id: itemId })
    if (error) {
      const reverted = new Set(doneRef.current)
      if (wasDone) reverted.add(itemId); else reverted.delete(itemId)
      doneRef.current = reverted
      setDone(reverted)
      console.warn(message(error))
      throw new Error(message(error))
    }
  }

  return { done, loading, toggle }
}

export function useBookingState(trip: string, client: SupabaseClient = supabase) {
  const [state, setState] = useState<Record<string, BookingStateRow>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { data, error } = await client.from('booking_state').select('*').eq('trip', trip)
      if (cancelled) return
      if (error) { console.warn(message(error)); setLoading(false); return }
      const map: Record<string, BookingStateRow> = {}
      for (const row of (data ?? []) as BookingStateRow[]) map[row.booking_id] = row
      setState(map)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [trip, client])

  async function save(bookingId: string, patch: Partial<Omit<BookingStateRow, 'trip' | 'booking_id' | 'updated_at'>>) {
    const updated_at = new Date().toISOString()
    const row = { trip, booking_id: bookingId, ...patch, updated_at }
    const { error } = await client.from('booking_state').upsert(row, { onConflict: 'trip,booking_id' })
    if (error) { console.warn(message(error)); throw new Error(message(error)) }
    setState(prev => ({ ...prev, [bookingId]: { ...prev[bookingId], ...row } as BookingStateRow }))
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
      setList((data ?? []) as AttachmentRow[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [trip, bookingId, client])

  async function upload(file: File) {
    const validType = file.type === 'application/pdf' || file.type.startsWith('image/')
    if (!validType || file.size > 25 * 1024 * 1024) {
      const msg = 'Only PDF or image files up to 25 MB'
      setError(msg)
      throw new Error(msg)
    }

    const safeName = `${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`
    const path = `${ownerId}/${trip}/${bookingId}/${safeName}`
    const { error: upErr } = await client.storage.from('tickets').upload(path, file, { contentType: file.type, upsert: false })
    if (upErr) { console.warn(message(upErr)); setError(message(upErr)); throw new Error(message(upErr)) }

    const { data, error: insErr } = await client.from('attachments')
      .insert({ trip, booking_id: bookingId, storage_path: path, filename: file.name, mime: file.type, size: file.size })
      .select().single()
    if (insErr) { console.warn(message(insErr)); setError(message(insErr)); throw new Error(message(insErr)) }
    setList(prev => [...prev, data as AttachmentRow])
    setError(null)
  }

  async function url(a: AttachmentRow) {
    const { data, error: sErr } = await client.storage.from('tickets').createSignedUrl(a.storage_path, 3600)
    if (sErr) { console.warn(message(sErr)); throw new Error(message(sErr)) }
    return (data as { signedUrl: string }).signedUrl
  }

  async function remove(a: AttachmentRow) {
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
  const pendingNote = useRef<(() => Promise<void>) | null>(null)
  // Set as soon as the user edits this day, so a slow initial load cannot overwrite their work.
  // Tracked per field: an unsent note must not also suppress the server's saved places.
  const dirtyText = useRef(false)
  const dirtyPlaces = useRef(false)

  useEffect(() => {
    let cancelled = false
    dirtyText.current = false
    dirtyPlaces.current = false
    setLoading(true)
    void (async () => {
      const { data, error } = await client.from('day_notes').select('*').eq('trip', trip).eq('date', date)
      if (cancelled) return
      if (error) { console.warn(message(error)); setLoading(false); return }
      const row = ((data ?? []) as DayNoteRow[])[0]
      if (!dirtyText.current) {
        noteRef.current = row?.text ?? ''
        setNoteState(noteRef.current)
      }
      if (!dirtyPlaces.current) {
        placesRef.current = row?.saved_places ?? []
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
  async function upsert(patch: { text: string } | { saved_places: SavedPlace[] }) {
    const row: Record<string, unknown> = { trip, date, ...patch, updated_at: new Date().toISOString() }
    const { error } = await client.from('day_notes').upsert(row, { onConflict: 'trip,date' })
    if (error) { console.warn(message(error)); throw new Error(message(error)) }
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

  async function writePlaces(next: SavedPlace[]) {
    const previous = placesRef.current
    const wasDirty = dirtyPlaces.current
    dirtyPlaces.current = true
    placesRef.current = next
    setSavedPlaces(next)
    try {
      await upsert({ saved_places: next })
    } catch (e) {
      // The write is gone, so this list is no longer a local edit worth defending —
      // let a still-pending load replace it with server truth.
      dirtyPlaces.current = wasDirty
      placesRef.current = previous
      setSavedPlaces(previous)
      throw e
    }
  }

  async function savePlace(place: SavedPlace) {
    if (placesRef.current.some(p => p.id === place.id)) return
    await writePlaces([...placesRef.current, place])
  }

  async function removePlace(id: string) {
    if (!placesRef.current.some(p => p.id === id)) return
    await writePlaces(placesRef.current.filter(p => p.id !== id))
  }

  return { note, savedPlaces, loading, setNote, savePlace, removePlace }
}
