import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
// maplibre-gl@6 ships named exports only (no default export), so this is a namespace import.
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { PMTiles, Protocol } from 'pmtiles'
import { useTrip } from '../lib/trip'
import { useChecks, useDayNotes, type SavedPlace } from '../lib/state'
import { buildStyle } from '../lib/mapStyle'
import { boundsFor, legsGeoJSON, parkedGeoJSON, placesGeoJSON, stopsGeoJSON } from '../lib/mapData'
import { cachedMapStatus, defaultSigner, downloadCityMaps, getCachedMap, MemorySource } from '../lib/offlineMaps'
import { fmtTime, todayInTrip } from '../lib/time'
import { walkLink } from '../lib/links'
import { MapSheet, type MapFeatureKind } from '../components/MapSheet'
import type { OfflineAreaRow } from '../lib/types'

const ACCENT = '#11da8f'
const MUTED = '#5a5b5d'
const COAL = '#202123'
const COLUMBIA = '#9ee1fe'
const TAP_LAYERS = ['stops-circle', 'parked-circle', 'places-circle']
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

type BasemapMode = 'cached' | 'signed' | 'none'
interface Basemap { mode: BasemapMode; sources: { id: string; url: string }[] }
interface Selected { kind: MapFeatureKind; id: string; properties: Record<string, unknown>; lngLat: [number, number] | null }

function sourceId(area: OfflineAreaRow): string { return `area-${area.seq}` }
function promptKey(trip: string): string { return `europe-guide.mapPromptDismissed.${trip}` }
function mb(bytes: number): string { return (bytes / (1024 * 1024)).toFixed(0) }

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

  map.addLayer({
    id: 'legs-line', type: 'line', source: 'legs',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ACCENT, 'line-width': 4, 'line-opacity': 0.8 },
  })
  map.addLayer({
    id: 'parked-circle', type: 'circle', source: 'parked',
    paint: { 'circle-radius': 5, 'circle-color': MUTED, 'circle-stroke-color': COAL, 'circle-stroke-width': 1 },
  })
  map.addLayer({
    id: 'stops-circle', type: 'circle', source: 'stops',
    paint: {
      'circle-radius': 9,
      'circle-color': ['case', ['get', 'done'], MUTED, ACCENT],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
  map.addLayer({
    id: 'stops-label', type: 'symbol', source: 'stops',
    layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Medium'], 'text-size': 12 },
    paint: { 'text-color': COAL },
  })
  map.addLayer({
    id: 'user-accuracy', type: 'circle', source: 'user',
    paint: { 'circle-radius': 24, 'circle-color': COLUMBIA, 'circle-opacity': 0.15 },
  })
  map.addLayer({
    id: 'user-dot', type: 'circle', source: 'user',
    paint: { 'circle-radius': 7, 'circle-color': COLUMBIA, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  })
}

function setData(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined
  source?.setData(data)
}

export default function Map() {
  const navigate = useNavigate()
  const { content } = useTrip()
  const trip = content?.trip ?? null
  const slug = trip?.slug ?? ''
  const { done } = useChecks(slug)

  const areas = useMemo<OfflineAreaRow[]>(() => content?.areas ?? [], [content])
  const date = useMemo(() => {
    if (!trip || !content) return null
    return todayInTrip(trip) ?? content.days[0]?.date ?? null
  }, [trip, content])

  const [showAll, setShowAll] = useState(false)
  const [basemap, setBasemap] = useState<Basemap | null>(null)
  const [status, setStatus] = useState<{ downloaded: number; total: number; bytes: number } | null>(null)
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const followRef = useRef(false)
  const fittedRef = useRef(false)

  const notes = useDayNotes(slug, date ?? '')

  useEffect(() => {
    if (!slug) return
    try { setPromptDismissed(localStorage.getItem(promptKey(slug)) === '1') } catch { /* private mode */ }
  }, [slug])

  // ---- basemap resolution -------------------------------------------------
  const resolveBasemap = useCallback(async (isStale: () => boolean) => {
    if (!slug) return
    const stat = await cachedMapStatus(slug, areas)
    if (isStale()) return
    setStatus(stat)

    if (stat.total > 0 && stat.downloaded === stat.total) {
      const protocol = pmtilesProtocol()
      const sources: { id: string; url: string }[] = []
      for (const area of areas) {
        const buf = await getCachedMap(slug, area.seq)
        if (!buf) continue
        const key = `maps/${slug}/${area.seq}`
        protocol.add(new PMTiles(new MemorySource(buf, key)))
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
  }, [slug, areas])

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    void resolveBasemap(() => cancelled)
    return () => { cancelled = true }
  }, [slug, resolveBasemap])

  // ---- map instance -------------------------------------------------------
  const basemapKey = basemap ? `${basemap.mode}:${basemap.sources.map(s => s.url).join('|')}` : null

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
    map.on('error', () => { setTileError(true) })
    map.on('click', TAP_LAYERS, (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      if (!feature) return
      const layerId = feature.layer?.id ?? ''
      const kind: MapFeatureKind = layerId === 'stops-circle' ? 'stop' : layerId === 'parked-circle' ? 'parked' : 'place'
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
    setData(map, 'user', user)
  }, [ready, stops, legs, parked, user])

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

  useEffect(() => {
    const goOnline = () => { setOnline(true); setTileError(false) }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  function locate() {
    const map = mapRef.current
    if (!map || !position) return
    followRef.current = true
    const zoom = Math.max(typeof map.getZoom === 'function' ? map.getZoom() : 0, 16)
    map.easeTo({ center: [position.lng, position.lat], zoom, duration: 400 })
  }

  function close() {
    if (window.history.length <= 1) navigate('/day')
    else navigate(-1)
  }

  async function handleDownload() {
    if (!slug) return
    setDownloading(true)
    setDownloadError(null)
    setProgress({ done: 0, total: areas.length })
    try {
      await downloadCityMaps(slug, areas, defaultSigner, (d, t) => setProgress({ done: d, total: t }))
      await resolveBasemap(() => false)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(false)
    }
  }

  function dismissPrompt() {
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
        walkHref: walkLink({ lat: row.lat, lng: row.lng, name: row.name, address: row.address }, trip.name),
        place: null,
      }
    }
    const props = selected.properties
    const name = String(props.title ?? props.name ?? 'Place')
    const rating = props.rating == null ? null : `★ ${props.rating}`
    const open = props.open == null ? null : props.open ? 'Open now' : 'Closed'
    const lngLat = selected.lngLat
    return {
      kind: 'place' as const,
      title: name,
      subtitle: [rating, open].filter(Boolean).join(' · ') || null,
      details: props.address == null ? null : String(props.address),
      walkHref: walkLink(
        { lat: lngLat ? lngLat[1] : null, lng: lngLat ? lngLat[0] : null, name },
        trip.name,
      ),
      place: lngLat
        ? { id: selected.id, name, lat: lngLat[1], lng: lngLat[0] } satisfies Omit<SavedPlace, 'saved_at'>
        : null,
    }
  }, [selected, content, trip])

  const alreadySaved = !!sheet?.place && notes.savedPlaces.some(p => p.id === sheet.place!.id)

  async function handleSave() {
    if (!sheet?.place) return
    setSaving(true)
    setSaveError(null)
    try {
      await notes.savePlace({ ...sheet.place, saved_at: new Date().toISOString() })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // ---- banner -------------------------------------------------------------
  const allCached = !!status && status.total > 0 && status.downloaded === status.total
  let banner: { text: string; actions?: 'download' | null } | null = null
  if (basemap?.mode === 'none' && areas.length === 0) {
    banner = { text: 'No offline map for this city yet' }
  } else if (basemap?.mode === 'none') {
    banner = { text: 'Offline map not downloaded — connect to wifi and download it from More' }
  } else if (!online || (tileError && basemap?.mode === 'signed')) {
    banner = { text: allCached ? 'Offline — showing saved map' : 'Offline — map tiles unavailable' }
  } else if (basemap?.mode === 'signed' && status?.downloaded === 0 && !promptDismissed && areas.length > 0) {
    const bytes = areas.reduce((sum, a) => sum + a.size_bytes, 0)
    banner = { text: `Download the ${trip?.name ?? 'city'} offline map (${mb(bytes)} MB)?`, actions: 'download' }
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
              <button type="button" className="btn--text" onClick={dismissPrompt}>Later</button>
            </div>
          )}
          {downloadError && <p className="form__msg form__msg--error">{downloadError}</p>}
        </div>
      )}

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
          walkHref={sheet.walkHref}
          onClose={() => { setSelected(null); setSaveError(null) }}
          onSave={sheet.place ? () => { void handleSave() } : undefined}
          saved={alreadySaved}
          saving={saving}
          error={saveError}
        />
      )}
    </main>
  )
}
