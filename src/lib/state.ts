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
