import { useCallback, useEffect, useMemo, useState } from 'react'
import { cachedMapStatus, deleteCityMaps, defaultSigner, downloadCityMaps, type Signer } from '../lib/offlineMaps'
import type { OfflineAreaRow } from '../lib/types'

interface Status { downloaded: number; total: number; bytes: number }

// What we last saw fully downloaded. iOS evicts the Cache API without telling anyone, so
// a remembered total that no longer matches the cache is the only signal that the map
// vanished rather than never having been fetched.
function downloadedKey(trip: string): string { return `europe-guide.mapsDownloaded.${trip}` }

function readDownloaded(trip: string): number | null {
  try {
    const raw = localStorage.getItem(downloadedKey(trip))
    return raw === null ? null : Number(raw)
  } catch {
    return null
  }
}

function writeDownloaded(trip: string, total: number | null) {
  try {
    if (total === null) localStorage.removeItem(downloadedKey(trip))
    else localStorage.setItem(downloadedKey(trip), String(total))
  } catch { /* private mode */ }
}

export function OfflineMapCard({ trip, areas, signer = defaultSigner, cacheStorage }: {
  trip: string
  areas: OfflineAreaRow[]
  signer?: Signer
  cacheStorage?: CacheStorage
}) {
  const [status, setStatus] = useState<Status | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [remembered, setRemembered] = useState<number | null>(() => readDownloaded(trip))

  const refresh = useCallback(async () => {
    const s = await cachedMapStatus(trip, areas, cacheStorage)
    setStatus(s)
    return s
  }, [trip, areas, cacheStorage])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => { setRemembered(readDownloaded(trip)) }, [trip])

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const totalMb = useMemo(() => {
    const bytes = areas.reduce((sum, a) => sum + a.size_bytes, 0)
    return (bytes / (1024 * 1024)).toFixed(1)
  }, [areas])

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    setProgress({ done: 0, total: areas.length })
    try {
      await downloadCityMaps(trip, areas, signer, (done, total) => setProgress({ done, total }), fetch, cacheStorage)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      const s = await refresh()
      if (s.total > 0 && s.downloaded === s.total) {
        writeDownloaded(trip, s.total)
        setRemembered(s.total)
      }
      setDownloading(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete the offline map for this city?')) return
    setError(null)
    try {
      await deleteCityMaps(trip, areas, cacheStorage)
      // A deliberate delete is not an eviction — forget the watermark so the next render
      // doesn't blame iOS for it.
      writeDownloaded(trip, null)
      setRemembered(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!status) return null

  const allDownloaded = status.total > 0 && status.downloaded === status.total
  const anyDownloaded = status.downloaded > 0
  const evicted = remembered !== null && status.total > 0
    && remembered === status.total && status.downloaded < status.total
  const primaryLabel = downloading
    ? `Downloading ${progress?.done ?? 0} of ${progress?.total ?? status.total}…`
    : allDownloaded ? 'Update' : 'Download'

  return (
    <div className="offline-map-card">
      <p className="offline-map-card__status">
        Offline map — {status.downloaded} of {status.total} areas · {(status.bytes / (1024 * 1024)).toFixed(1)} of {totalMb} MB
      </p>
      {evicted && <p className="caption">Map data was cleared by iOS — re-download</p>}
      <div className="offline-map-card__actions">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={downloading || (!online && !allDownloaded)}
          onClick={() => { void handleDownload() }}
        >
          {primaryLabel}
        </button>
        {anyDownloaded && !downloading && (
          <button type="button" className="btn btn--secondary" onClick={() => { void handleDelete() }}>
            Delete
          </button>
        )}
      </div>
      {!online && !allDownloaded && <p className="caption">Connect to wifi to download</p>}
      {error && <p className="form__msg form__msg--error">{error}</p>}
    </div>
  )
}
