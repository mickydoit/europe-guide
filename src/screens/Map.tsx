import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
// maplibre-gl@6 ships named exports only (no default export), so this is a namespace import.
import * as maplibregl from 'maplibre-gl'
// The bundler does not emit MapLibre's module worker; serve the copies in public/map/ instead.
// import.meta.env.BASE_URL is Vite's configured base path (`/europe-guide/` in this
// deployment) rather than a literal, so this keeps working if the base path changes.
const WORKER_BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
maplibregl.setWorkerUrl(new URL(`${WORKER_BASE}/map/maplibre-gl-worker.mjs`, typeof location !== 'undefined' ? location.origin : 'https://mickydoit.github.io').href)
import 'maplibre-gl/dist/maplibre-gl.css'
import { PMTiles, Protocol } from 'pmtiles'
import { useTrip } from '../lib/trip'
import { useMapNeeds } from '../lib/mapReadiness'
import { useChecks, useDayNotes, QUEUED_COPY, type SavedPlace } from '../lib/state'
import { buildStyle } from '../lib/mapStyle'
import { boundsFor, legsGeoJSON, parkedGeoJSON, placesGeoJSON, stopsGeoJSON } from '../lib/mapData'
import { cachedMapStatus, defaultSigner, downloadCityMaps, getCachedMap, getMapsGeneration, MemorySource } from '../lib/offlineMaps'
import { fmtTime, todayInTrip } from '../lib/time'
import { walkLink } from '../lib/links'
import { bookingForStop, effectiveStatus, ticketLinkLabel } from '../lib/tickets'
import { useAttachedBookingIds } from '../lib/attached'
import { MapSheet, type MapFeatureKind } from '../components/MapSheet'
import { nearbyPlaces, nearestN, photoUrl, placePhoto, shouldRefetch, type Place } from '../lib/places'
import type { OfflineAreaRow } from '../lib/types'

const ACCENT = '#22DD85'
const MUTED = '#5a5b5d'
const COAL = '#202123'
const LAVENDER = '#BCA5ED'
// Taps land on the invisible wide-radius hit layers, not the small painted circles:
// a 9 px marker is well under the 44 px touch target a thumb actually aims at.
const TAP_LAYERS = ['stops-hit', 'parked-hit', 'places-hit']
const HIT_RADIUS = 20
// Signed pmtiles URLs expire after an hour; re-sign at most this often so a burst
// of tile errors cannot turn into a burst of storage calls.
const RESIGN_COOLDOWN_MS = 5 * 60 * 1000
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

// One protocol per page load: maplibre keys custom protocols globally, so a second
// addProtocol('pmtiles', …) after a remount would orphan the archives already added.
let protocolSingleton: Protocol | null = null
function pmtilesProtocol(): Protocol {
  if (!protocolSingleton) {
    protocolSingleton = new Protocol()
    maplibregl.addProtocol('pmtiles', protocolSingleton.tile)
  }
  return protocolSingleton
}

// Archives live on the protocol singleton for the whole page load, so a remount must
// not re-read the (multi-MB) buffer out of the Cache API and hand the protocol a second
// copy of an archive it already holds. Keys already registered are skipped entirely.
const pmtilesRegistry = new globalThis.Set<string>()
// The generation the registered archives were built from. A download or a delete moves the
// module's counter on; when it no longer matches, every registration is stale and has to be
// dropped so the next pass re-reads the cache and calls protocol.add again (which replaces
// the archive stored under the same key).
let registryGeneration = getMapsGeneration()

export function resetPmtilesRegistryForTests(): void {
  pmtilesRegistry.clear()
  registryGeneration = getMapsGeneration()
}

// Session cache of Place Details photo lookups, keyed by place id: a photo is billed
// per Details call, so a place opened twice in one page load must fetch it once. Never
// persisted — a fresh page load starts empty.
const placePhotoCache = new globalThis.Map<string, Promise<string | null>>()

export function resetPlacePhotoCacheForTests(): void {
  placePhotoCache.clear()
}

type BasemapMode = 'cached' | 'signed' | 'none'
interface Basemap { mode: BasemapMode; sources: { id: string; url: string }[]; reason?: 'storage' }
interface Selected { kind: MapFeatureKind; id: string; properties: Record<string, unknown>; lngLat: [number, number] | null }

function sourceId(area: OfflineAreaRow): string { return `area-${area.seq}` }
function promptKey(trip: string): string { return `europe-guide.mapPromptDismissed.${trip}` }
/**
 * The stale-map offer gets its own dismissal, keyed by the size the rows advertise: a "Later"
 * tapped months ago on the first download offer must not silence "the map you saved is out of
 * date", and a fresh re-cut (a new total size) re-arms the offer it was dismissed for.
 */
function stalePromptKey(trip: string, bytes: number): string {
  return `europe-guide.mapStalePromptDismissed.${trip}.${bytes}`
}
function mb(bytes: number): string { return (bytes / (1024 * 1024)).toFixed(0) }

const PLACES_ENABLED_KEY = 'europe-guide.places'

function loadPlacesEnabled(): boolean {
  try {
    const raw = localStorage.getItem(PLACES_ENABLED_KEY)
    return raw === null ? true : raw === '1'
  } catch {
    return true
  }
}

function userGeoJSON(pos: { lat: number; lng: number } | null): GeoJSON.FeatureCollection {
  if (!pos) return EMPTY
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [pos.lng, pos.lat] }, properties: {} }],
  }
}

function addLayers(map: maplibregl.Map) {
  map.addSource('legs', { type: 'geojson', data: EMPTY })
  map.addSource('parked', { type: 'geojson', data: EMPTY })
  map.addSource('stops', { type: 'geojson', data: EMPTY })
  map.addSource('places', { type: 'geojson', data: placesGeoJSON([]) })
  map.addSource('user', { type: 'geojson', data: EMPTY })

  // Walking legs are solid; driving and transit legs are dashed (MapLibre can't set
  // line-dasharray per-feature within one layer, so the mode split needs two layers).
  // Untyped to the style spec (like `isDone` below): a nested array literal here infers
  // as a plain array, not the tuple `match` expects.
  const legColor: unknown = ['match', ['get', 'mode'], 'driving', '#F7FF88', 'transit', LAVENDER, ACCENT]
  map.addLayer({
    id: 'legs-line', type: 'line', source: 'legs',
    filter: ['==', ['get', 'mode'], 'walking'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': legColor, 'line-width': 4, 'line-opacity': 0.8 },
  } as maplibregl.AddLayerObject)
  map.addLayer({
    id: 'legs-line-dashed', type: 'line', source: 'legs',
    filter: ['!=', ['get', 'mode'], 'walking'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': legColor, 'line-width': 4, 'line-opacity': 0.8, 'line-dasharray': [2, 2] },
  } as maplibregl.AddLayerObject)
  map.addLayer({
    id: 'parked-circle', type: 'circle', source: 'parked',
    paint: { 'circle-radius': 5, 'circle-color': MUTED, 'circle-stroke-color': COAL, 'circle-stroke-width': 1 },
  })
  // ['get','done'] is untyped to the style spec, so wrap it: a bare get in a `case`
  // test throws "Expected boolean but found value" at style-validation time.
  const isDone: unknown = ['boolean', ['get', 'done'], false]
  map.addLayer({
    id: 'stops-circle', type: 'circle', source: 'stops',
    paint: {
      'circle-radius': 9,
      'circle-color': ['case', isDone, MUTED, ACCENT],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  } as maplibregl.AddLayerObject)
  map.addLayer({
    id: 'stops-label', type: 'symbol', source: 'stops',
    layout: {
      'text-field': ['get', 'n'],
      'text-font': ['Noto Sans Medium'],
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': ['case', isDone, '#ffffff', COAL] },
  } as maplibregl.AddLayerObject)
  map.addLayer({
    id: 'places-circle', type: 'circle', source: 'places',
    paint: {
      'circle-radius': 9,
      'circle-color': '#f8c1b8',
      'circle-stroke-color': COAL,
      'circle-stroke-width': 1.5,
    },
  })
  map.addLayer({
    id: 'places-label', type: 'symbol', source: 'places',
    layout: {
      'text-field': '!',
      'text-font': ['Noto Sans Medium'],
      'text-size': 13,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': COAL },
  })
  map.addLayer({
    id: 'user-accuracy', type: 'circle', source: 'user',
    paint: { 'circle-radius': 24, 'circle-color': LAVENDER, 'circle-opacity': 0.15 },
  })
  map.addLayer({
    id: 'user-dot', type: 'circle', source: 'user',
    paint: { 'circle-radius': 7, 'circle-color': LAVENDER, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  })

  // Hit targets last, so they sit above every painted layer and always win the tap.
  for (const source of ['parked', 'stops', 'places'] as const) {
    map.addLayer({
      id: `${source}-hit`, type: 'circle', source,
      paint: { 'circle-radius': HIT_RADIUS, 'circle-opacity': 0 },
    })
  }
}

function setData(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined
  source?.setData(data)
}

export default function Map() {
  const navigate = useNavigate()
  const location = useLocation()
  const { date: dateParam } = useParams<{ date?: string }>()
  const { content } = useTrip()
  const trip = content?.trip ?? null
  const attached = useAttachedBookingIds(trip?.slug ?? '')
  const slug = trip?.slug ?? ''
  const { done } = useChecks(slug)

  const areas = useMemo<OfflineAreaRow[]>(() => content?.areas ?? [], [content])
  const mapNeeds = useMapNeeds()
  // /map/:date pins the map to the day you came from; anything else (no param, or a
  // date that isn't in this trip) falls back to today, then to the first day.
  const date = useMemo(() => {
    if (!trip || !content) return null
    if (dateParam && content.days.some(d => d.date === dateParam)) return dateParam
    return todayInTrip(trip) ?? content.days[0]?.date ?? null
  }, [trip, content, dateParam])

  const [showAll, setShowAll] = useState(false)
  const [basemap, setBasemap] = useState<Basemap | null>(null)
  const [status, setStatus] = useState<{ downloaded: number; total: number; bytes: number; stale: boolean } | null>(null)
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [geoDenied, setGeoDenied] = useState(false)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [tileError, setTileError] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [promptDismissed, setPromptDismissed] = useState(false)
  const [staleDismissed, setStaleDismissed] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveQueued, setSaveQueued] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [placesEnabled, setPlacesEnabled] = useState(loadPlacesEnabled)

  const mountedRef = useRef(true)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const followRef = useRef(false)
  const fittedRef = useRef(false)
  // Session cache of Places results, keyed by place id: never persisted, never
  // refetched more than shouldRefetch allows, and the sheet's source of truth
  // for a tapped place (the GeoJSON feature only carries the marker fields).
  const placesRef = useRef<globalThis.Map<string, Place>>(new globalThis.Map())
  const lastPlacesQueryRef = useRef<{ lat: number; lng: number; at: number } | null>(null)
  const lastResignAt = useRef(0)

  const placesKey = (import.meta.env.VITE_GOOGLE_BROWSER_KEY as string | undefined) || null

  const notes = useDayNotes(slug, date ?? '')

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const areasBytes = useMemo(() => areas.reduce((sum, a) => sum + a.size_bytes, 0), [areas])

  useEffect(() => {
    if (!slug) return
    try {
      setPromptDismissed(localStorage.getItem(promptKey(slug)) === '1')
      setStaleDismissed(localStorage.getItem(stalePromptKey(slug, areasBytes)) === '1')
    } catch { /* private mode */ }
  }, [slug, areasBytes])

  // ---- basemap resolution -------------------------------------------------
  // Every storage read in here can throw outright — Safari private mode denies the
  // Cache API, and a quota-evicted origin can reject `caches.open`. A thrown basemap
  // must still leave a usable screen, so the whole body is guarded and falls back to
  // the markers-only style rather than leaving `basemap` null (which renders nothing).
  const resolveBasemap = useCallback(async (isStale: () => boolean) => {
    if (!slug) return
    try {
      if (getMapsGeneration() !== registryGeneration) {
        pmtilesRegistry.clear()
        registryGeneration = getMapsGeneration()
      }
      const stat = await cachedMapStatus(slug, areas)
      if (isStale()) return
      setStatus(stat)

      if (stat.total > 0 && stat.downloaded === stat.total) {
        const protocol = pmtilesProtocol()
        const sources: { id: string; url: string }[] = []
        for (const area of areas) {
          const key = `maps/${slug}/${area.seq}`
          if (!pmtilesRegistry.has(key)) {
            const buf = await getCachedMap(slug, area.seq)
            if (!buf) continue
            protocol.add(new PMTiles(new MemorySource(buf, key)))
            pmtilesRegistry.add(key)
          }
          sources.push({ id: sourceId(area), url: `pmtiles://${key}` })
        }
        if (isStale()) return
        setBasemap({ mode: 'cached', sources })
        return
      }

      if (areas.length > 0 && typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          pmtilesProtocol()
          const sources: { id: string; url: string }[] = []
          for (const area of areas) {
            sources.push({ id: sourceId(area), url: `pmtiles://${await defaultSigner(area.pmtiles_path)}` })
          }
          if (isStale()) return
          setBasemap({ mode: 'signed', sources })
          return
        } catch (e) {
          console.warn(e instanceof Error ? e.message : String(e))
        }
      }

      if (isStale()) return
      setBasemap({ mode: 'none', sources: [] })
    } catch (e) {
      console.warn('map storage', e)
      if (isStale()) return
      setBasemap({ mode: 'none', sources: [], reason: 'storage' })
    }
  }, [slug, areas])

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    void resolveBasemap(() => cancelled)
    return () => { cancelled = true }
  }, [slug, resolveBasemap])

  // ---- map instance -------------------------------------------------------
  const basemapKey = basemap ? `${basemap.mode}:${basemap.sources.map(s => s.url).join('|')}` : null

  // The map effect outlives a `resolveBasemap` identity change (areas are memoised on
  // `content`, which the trip provider can refresh), so reach it through a ref.
  const resolveRef = useRef(resolveBasemap)
  useEffect(() => { resolveRef.current = resolveBasemap }, [resolveBasemap])

  // A signed pmtiles URL is good for an hour; a tile error (or coming back online) on a
  // signed basemap is the symptom of it having expired, so re-sign — rate-limited, since
  // every failing tile in the viewport fires its own error event.
  const maybeResign = useCallback(() => {
    if (basemap?.mode !== 'signed') return
    const now = Date.now()
    if (now - lastResignAt.current < RESIGN_COOLDOWN_MS) return
    lastResignAt.current = now
    void resolveRef.current(() => !mountedRef.current)
  }, [basemap?.mode])

  useEffect(() => {
    const container = containerRef.current
    if (!basemap || !container) return
    setReady(false)
    fittedRef.current = false

    const map = new maplibregl.Map({
      container,
      style: buildStyle(basemap.sources),
      center: [0, 0],
      zoom: 2,
      attributionControl: false,
    })
    mapRef.current = map

    map.on('load', () => { addLayers(map); setReady(true) })
    map.on('dragstart', () => { followRef.current = false })
    // Never log the error's URL: for a signed basemap it carries the storage token.
    map.on('error', (e: { error?: { status?: number; message?: string } }) => {
      console.warn('map error', e?.error?.status ?? e?.error?.message ?? 'unknown')
      setTileError(true)
      maybeResign()
    })
    map.on('sourcedata', (e: { isSourceLoaded?: boolean }) => {
      if (e?.isSourceLoaded) setTileError(false)
    })
    map.on('click', TAP_LAYERS, (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      if (!feature) return
      const layerId = feature.layer?.id ?? ''
      const kind: MapFeatureKind = layerId.startsWith('stops') ? 'stop' : layerId.startsWith('parked') ? 'parked' : 'place'
      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const geometry = feature.geometry as GeoJSON.Geometry | undefined
      const lngLat = geometry?.type === 'Point' ? (geometry.coordinates as [number, number]) : null
      setSelected({ kind, id: String(properties.id ?? ''), properties, lngLat })
    })
    map.on('mouseenter', TAP_LAYERS, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', TAP_LAYERS, () => { map.getCanvas().style.cursor = '' })

    return () => {
      mapRef.current = null
      map.remove()
    }
    // basemapKey collapses the source list into a stable identity for this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemapKey])

  // ---- geojson data -------------------------------------------------------
  const filterDate = showAll ? null : date
  const stops = useMemo(
    () => (content ? stopsGeoJSON(content, filterDate, done) : EMPTY),
    [content, filterDate, done],
  )
  const legs = useMemo(() => (content ? legsGeoJSON(content, filterDate) : EMPTY), [content, filterDate])
  const parked = useMemo(() => (content ? parkedGeoJSON(content) : EMPTY), [content])
  const user = useMemo(() => userGeoJSON(position), [position])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    setData(map, 'stops', stops)
    setData(map, 'legs', legs)
    setData(map, 'parked', parked)
  }, [ready, stops, legs, parked])

  // Its own effect: a GPS tick arrives every second or two and must not redraw the itinerary.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    setData(map, 'user', user)
  }, [ready, user])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || fittedRef.current) return
    const area = areas[0]
    const bounds = boundsFor(stops)
      ?? boundsFor(legs)
      ?? (area ? [area.min_lng, area.min_lat, area.max_lng, area.max_lat] as [number, number, number, number] : null)
    if (!bounds) return
    fittedRef.current = true
    map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 })
  }, [ready, stops, legs, areas])

  // ---- geolocation --------------------------------------------------------
  useEffect(() => {
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation
    if (!geo) return
    const id = geo.watchPosition(
      pos => {
        setGeoDenied(false)
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        const map = mapRef.current
        if (map && followRef.current) {
          map.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], duration: 400 })
        }
      },
      err => { if (err.code === 1) setGeoDenied(true) },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )
    return () => { geo.clearWatch?.(id) }
  }, [])

  // ---- places toggle persistence -------------------------------------------
  useEffect(() => {
    try { localStorage.setItem(PLACES_ENABLED_KEY, placesEnabled ? '1' : '0') } catch { /* private mode */ }
  }, [placesEnabled])

  // Toggled off: clear the layer immediately and let the fetch effect below skip
  // fetching until it's back on.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || placesEnabled) return
    setData(map, 'places', placesGeoJSON([]))
  }, [placesEnabled, ready])

  // ---- places fetch ---------------------------------------------------------
  useEffect(() => {
    if (!placesKey || !placesEnabled || !position) return
    const map = mapRef.current
    if (!map || !ready) return
    const now = { lat: position.lat, lng: position.lng, at: Date.now() }
    if (!shouldRefetch(lastPlacesQueryRef.current, now)) return
    // Set before the await so a fast follow-up position tick doesn't fire a second
    // in-flight request while this one is still resolving.
    lastPlacesQueryRef.current = now

    let cancelled = false
    nearbyPlaces(position.lat, position.lng, placesKey)
      .then(found => {
        if (cancelled) return
        for (const place of found) placesRef.current.set(place.id, place)
        const all = nearestN([...placesRef.current.values()], position.lat, position.lng)
        const m = mapRef.current
        if (m) setData(m, 'places', placesGeoJSON(all))
      })
      .catch(e => console.warn(e instanceof Error ? e.message : String(e)))
    return () => { cancelled = true }
  }, [position, placesEnabled, placesKey, ready])

  useEffect(() => {
    const goOnline = () => { setOnline(true); setTileError(false); maybeResign() }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [maybeResign])

  function centreOn(lat: number, lng: number) {
    const map = mapRef.current
    if (!map) return
    const zoom = Math.max(typeof map.getZoom === 'function' ? map.getZoom() : 0, 16)
    map.easeTo({ center: [lng, lat], zoom, duration: 400 })
  }

  function locate() {
    followRef.current = true
    if (position) { centreOn(position.lat, position.lng); return }
    // No fix yet (the watch can take a while on a cold start): ask for one directly.
    navigator.geolocation?.getCurrentPosition?.(
      pos => {
        if (!mountedRef.current) return
        setGeoDenied(false)
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        centreOn(pos.coords.latitude, pos.coords.longitude)
      },
      err => { if (err.code === 1 && mountedRef.current) setGeoDenied(true) },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )
  }

  function close() {
    // react-router stamps the first entry of a history stack with key 'default'; anything
    // else means there is a real previous screen to go back to. window.history.length is
    // the whole tab's history, which on iOS includes entries from before the PWA loaded.
    if (location.key !== 'default') navigate(-1)
    else navigate('/day', { replace: true })
  }

  async function handleDownload() {
    if (!slug) return
    setDownloading(true)
    setDownloadError(null)
    setProgress({ done: 0, total: areas.length })
    try {
      await downloadCityMaps(slug, areas, defaultSigner, (d, t) => {
        if (mountedRef.current) setProgress({ done: d, total: t })
      })
      await resolveBasemap(() => !mountedRef.current)
    } catch (e) {
      if (mountedRef.current) setDownloadError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mountedRef.current) setDownloading(false)
    }
  }

  function dismissPrompt(kind: 'download' | 'stale') {
    if (kind === 'stale') {
      setStaleDismissed(true)
      try { localStorage.setItem(stalePromptKey(slug, areasBytes), '1') } catch { /* private mode */ }
      return
    }
    setPromptDismissed(true)
    try { localStorage.setItem(promptKey(slug), '1') } catch { /* private mode */ }
  }

  // ---- sheet --------------------------------------------------------------
  const sheet = useMemo(() => {
    if (!selected || !content || !trip) return null
    if (selected.kind === 'stop') {
      const item = content.items.find(i => i.id === selected.id)
      if (!item) return null
      return {
        kind: 'stop' as const,
        title: (item.place_name ?? item.plan).replace(/\*\*/g, ''),
        subtitle: fmtTime(item.time, item.time_text),
        details: item.details,
        photoSrc: null,
        walkHref: walkLink({ lat: item.lat, lng: item.lng, name: item.place_name ?? item.plan, address: item.address }, trip.name),
        place: null,
      }
    }
    if (selected.kind === 'parked') {
      const seq = Number(selected.id.replace('parked:', ''))
      const row = content.parked.find(p => p.seq === seq)
      if (!row) return null
      return {
        kind: 'parked' as const,
        title: row.name,
        subtitle: row.what,
        details: row.why,
        photoSrc: null,
        walkHref: walkLink({ lat: row.lat, lng: row.lng, name: row.name, address: row.address }, trip.name),
        place: null,
      }
    }
    // Full detail (rating count, address, photo) lives only in the session
    // Places cache; the GeoJSON feature carries just the marker fields.
    const place = placesRef.current.get(selected.id)
    if (!place) return null
    const rating = place.rating == null
      ? null
      : `★ ${place.rating}${place.ratingCount == null ? '' : ` (${place.ratingCount.toLocaleString()})`}`
    const open = place.openNow == null ? null : place.openNow ? 'Open now' : 'Closed'
    return {
      kind: 'place' as const,
      title: place.name,
      subtitle: [rating, open].filter(Boolean).join(' · ') || null,
      details: place.address,
      walkHref: walkLink({ lat: place.lat, lng: place.lng, name: place.name, address: place.address }, trip.name),
      place: { id: place.id, name: place.name, lat: place.lat, lng: place.lng } satisfies Omit<SavedPlace, 'saved_at'>,
    }
  }, [selected, content, trip, placesKey])

  const alreadySaved = !!sheet?.place && notes.savedPlaces.some(p => p.id === sheet.place!.id)

  // The sheet object doesn't carry the underlying item, so look it up again here (cheap:
  // it's the same find the sheet memo just did) to compute the ticket link once.
  const sheetItem = selected?.kind === 'stop' && content ? content.items.find(i => i.id === selected.id) ?? null : null
  const sheetBooking = sheetItem ? bookingForStop(content?.bookings ?? [], sheetItem) : null

  // ---- lazy place photo -----------------------------------------------------
  // Cost trim: the nearby search field mask no longer requests photos, so a place's
  // photo is fetched from Place Details only when its sheet actually opens, once per
  // id per session (placePhotoCache), and only when online.
  const [placePhotoSrc, setPlacePhotoSrc] = useState<string | null>(null)
  const placeId = sheet?.kind === 'place' ? sheet.place?.id : undefined

  useEffect(() => {
    setPlacePhotoSrc(null)
    if (!placeId || !placesKey) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    let cached = placePhotoCache.get(placeId)
    if (!cached) {
      cached = placePhoto(placeId, placesKey).catch(e => {
        console.warn(e instanceof Error ? e.message : String(e))
        return null
      })
      placePhotoCache.set(placeId, cached)
    }

    let cancelled = false
    cached.then(name => {
      if (cancelled || !name) return
      setPlacePhotoSrc(photoUrl(name, placesKey))
    })
    return () => { cancelled = true }
  }, [placeId, placesKey])

  async function handleSave() {
    if (!sheet?.place) return
    // Offline is no longer a dead end: useDayNotes queues the write and sync.ts sends it later.
    setSaving(true)
    setSaveError(null)
    setSaveQueued(null)
    try {
      const result = await notes.savePlace({ ...sheet.place, saved_at: new Date().toISOString() })
      if (result?.queued) setSaveQueued(QUEUED_COPY)
    } catch (e) {
      // The raw PostgREST message is noise to the person holding the phone.
      console.warn('save place', e instanceof Error ? e.message : String(e))
      setSaveError("Couldn't save — try again when online")
    } finally {
      setSaving(false)
    }
  }

  // ---- banner -------------------------------------------------------------
  // Cities still ahead of you; the one on screen speaks for itself through the offers below.
  const aheadNeeds = mapNeeds.filter(n => n.slug !== slug)
  const allCached = !!status && status.total > 0 && status.downloaded === status.total
  // A stale map counts as not downloaded for the prompt: the tiles on the phone are from a
  // different cut of the city. Each offer carries its own dismissal.
  const staleOffer = areas.length > 0 && !!status?.stale && !staleDismissed
  const downloadOffer = areas.length > 0 && basemap?.mode === 'signed' && status?.downloaded === 0 && !promptDismissed
  let banner: { text: string; actions?: 'download' | null; dismiss?: 'download' | 'stale' } | null = null
  if (basemap?.reason === 'storage') {
    banner = { text: 'Map storage unavailable — markers still shown' }
  } else if (basemap?.mode === 'none' && areas.length === 0) {
    banner = { text: 'No offline map for this city yet' }
  } else if (basemap?.mode === 'none') {
    banner = { text: 'Offline map not downloaded — connect to wifi and download it from More' }
  } else if (!online || (tileError && basemap?.mode === 'signed')) {
    banner = { text: allCached ? 'Offline — showing saved map' : 'Offline — map tiles unavailable' }
  } else if (staleOffer || downloadOffer) {
    banner = {
      text: staleOffer
        ? `Map data changed — update the offline map (${mb(areasBytes)} MB)?`
        : `Download the ${trip?.name ?? 'city'} offline map (${mb(areasBytes)} MB)?`,
      actions: 'download',
      dismiss: staleOffer ? 'stale' : 'download',
    }
  } else if (aheadNeeds.length > 0) {
    // Lowest priority: only once this city has nothing to say for itself. Without it the dot
    // on the Map tab would send the owner to a working map with no hint of what lit it.
    banner = { text: `${aheadNeeds.map(n => n.name).join(' and ')} — offline map not saved. Get it in More.` }
  }

  return (
    <main className="map-screen">
      <div className="map-canvas" ref={containerRef} data-testid="map-canvas" />

      <button type="button" className="map-close" aria-label="Close map" onClick={close}>Close</button>

      <div className="map-seg" role="group" aria-label="Days shown">
        <button
          type="button"
          className={`map-seg__btn${showAll ? '' : ' is-active'}`}
          aria-pressed={!showAll}
          onClick={() => setShowAll(false)}
        >
          Today
        </button>
        <button
          type="button"
          className={`map-seg__btn${showAll ? ' is-active' : ''}`}
          aria-pressed={showAll}
          onClick={() => setShowAll(true)}
        >
          All
        </button>
      </div>

      {banner && (
        <div className="map-banner" role="status">
          <p className="map-banner__text">
            {downloading ? `Downloading ${progress?.done ?? 0} of ${progress?.total ?? areas.length}…` : banner.text}
          </p>
          {banner.actions === 'download' && !downloading && (
            <div className="map-banner__actions">
              <button type="button" className="btn--text" onClick={() => { void handleDownload() }}>Download</button>
              <button type="button" className="btn--text" onClick={() => dismissPrompt(banner?.dismiss ?? 'download')}>Later</button>
            </div>
          )}
          {downloadError && <p className="form__msg form__msg--error">{downloadError}</p>}
        </div>
      )}

      <button
        type="button"
        className={`map-places-toggle${placesEnabled ? '' : ' is-off'}`}
        aria-label="Toggle nearby places"
        aria-pressed={placesEnabled}
        onClick={() => setPlacesEnabled(v => !v)}
      >
        !
      </button>

      <button type="button" className="map-locate" aria-label="Locate me" onClick={locate}>◎</button>

      {geoDenied && (
        <p className="map-geo-caption caption">Location off — enable it in Settings › Safari › Location</p>
      )}

      {sheet && (
        <MapSheet
          open
          kind={sheet.kind}
          title={sheet.title}
          subtitle={sheet.subtitle}
          details={sheet.details}
          photoSrc={sheet.kind === 'place' ? placePhotoSrc : sheet.photoSrc}
          walkHref={sheet.walkHref}
          ticketHref={sheetBooking && trip ? `/ticket/${trip.slug}/${sheetBooking.id}?trip=${trip.slug}` : null}
          ticketLabel={sheetBooking ? ticketLinkLabel(effectiveStatus(sheetBooking, undefined), attached.has(sheetBooking.id)) : undefined}
          onClose={() => { setSelected(null); setSaveError(null); setSaveQueued(null) }}
          onSave={sheet.place ? () => { void handleSave() } : undefined}
          saved={alreadySaved}
          saving={saving}
          error={saveError}
          queuedMsg={saveQueued}
        />
      )}
    </main>
  )
}
