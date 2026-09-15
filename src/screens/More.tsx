import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { TripRow } from '../lib/types'
export function More() {
  const { signOut, session } = useAuth(); const [trips, setTrips] = useState<TripRow[]>([])
  useEffect(() => { supabase.from('trips').select('*').order('sort').then(({ data }) => setTrips((data ?? []) as TripRow[])) }, [])
  return (
    <main className="screen">
      <h1 className="h5">More</h1>
      <p className="caption">{session?.user.email}</p>
      <ul>{trips.map(t => <li key={t.slug}>{t.name} · {t.start_date} → {t.end_date}</li>)}</ul>
      <button onClick={signOut}>Sign out</button>
    </main>
  )
}
