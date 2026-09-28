import { Link } from 'react-router-dom'

/**
 * The Suspense fallback for the lazily imported Map screen.
 *
 * It needs its own way out: TabBar renders nothing on /map (the map is full-bleed by design),
 * and the Close button belongs to the Map component itself — which is precisely what has not
 * arrived yet. A chunk that hangs on a weak connection therefore used to leave the owner on a
 * bare "Loading map…" line with no control on screen at all.
 */
export function MapLoading() {
  return (
    <main className="screen">
      <Link to="/" className="btn--text">‹ Close</Link>
      <p className="caption">Loading map…</p>
    </main>
  )
}
