import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { getAttachedIds, putAttachedIds } from './db'

/** The set of booking ids in this trip that carry a real attachment. Starts from the IndexedDB
 *  copy so the answer is right offline, then refreshes from the server when it can. */
export function useAttachedBookingIds(trip: string, client: SupabaseClient = supabase): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    if (!trip) { setIds(new Set()); return }
    void (async () => {
      try {
        const cached = await getAttachedIds(trip)
        if (!cancelled && cached.length) setIds(new Set(cached))
      } catch { /* no IndexedDB: fall through to the network */ }
      try {
        const { data, error } = await client.from('attachments').select('booking_id').eq('trip', trip)
        if (cancelled || error || !data) return
        const next = Array.from(new Set((data as { booking_id: string }[]).map(r => r.booking_id)))
        setIds(new Set(next))
        try { await putAttachedIds(trip, next) } catch { /* cache only */ }
      } catch { /* offline: keep the cached answer */ }
    })()
    return () => { cancelled = true }
  }, [trip, client])
  return ids
}
