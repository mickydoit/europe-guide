import '../helpers/blobClone'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useChecks, useBookingState, useAttachments, useDayNotes } from '../../src/lib/state'
import type { SavedPlace } from '../../src/lib/state'
import { resetDbForTests } from '../../src/lib/db'
import * as outbox from '../../src/lib/outbox'
import { enqueue, listOutbox } from '../../src/lib/outbox'
import type { AttachmentUploadPayload, CheckSetPayload, DayNotesPayload } from '../../src/lib/outbox'
import { resetSyncForTests } from '../../src/lib/sync'

// Every write now lands in the outbox when it cannot reach the server, so each test needs
// a queue of its own — otherwise one test's queued tick reconciles into the next one's load.
async function wipe() {
  resetSyncForTests()
  await resetDbForTests()
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase('europe-guide')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

beforeEach(wipe)

/** Fake-clock milliseconds a hook's initial load needs, IndexedDB outbox read included. */
const LOAD_MS = 50

/** Pretend the phone lost signal for the duration of one test. */
function goOffline() {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
}

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

type Row = Record<string, unknown>
type Res<T> = { data: T | null; error: { message: string } | null }
type Call = { table: string; mode: string; payload?: unknown; filters: Array<[string, unknown]>; like: [string, string] | null; upsertOpts?: unknown; single: boolean }

function makeTable(table: string, initial: Row[], calls: Call[], hooks: {
  onInsert?: (payload: unknown) => Res<unknown>
  onDelete?: () => Res<unknown>
  onUpsert?: (payload: unknown) => Res<unknown>
} = {}) {
  let rows: Row[] = [...initial]
  let nextInsertId = 1
  function build() {
    let mode: 'select' | 'insert' | 'delete' | 'upsert' = 'select'
    let payload: unknown
    let upsertOpts: unknown
    const filters: Array<[string, unknown]> = []
    let like: [string, string] | null = null
    let single = false
    const q: Record<string, unknown> = {
      select() { return q },
      order() { return q },
      insert(p: unknown) { mode = 'insert'; payload = p; return q },
      delete() { mode = 'delete'; return q },
      upsert(p: unknown, o: unknown) { mode = 'upsert'; payload = p; upsertOpts = o; return q },
      eq(col: string, val: unknown) { filters.push([col, val]); return q },
      like(col: string, pattern: string) { like = [col, pattern]; return q },
      single() { single = true; return q },
      then(resolve: (r: Res<unknown>) => void) {
        calls.push({ table, mode, payload, filters, like, upsertOpts, single })
        if (mode === 'select') {
          let out = rows
          for (const [c, v] of filters) out = out.filter(r => r[c] === v)
          if (like) { const prefix = like[1].replace(/%$/, ''); out = out.filter(r => String(r[like![0]]).startsWith(prefix)) }
          resolve({ data: single ? (out[0] ?? null) : out, error: null })
        } else if (mode === 'insert') {
          const withId = (r: Row): Row => (r.id === undefined ? { ...r, id: `fake-${nextInsertId++}` } : r)
          const insertPayload = Array.isArray(payload) ? (payload as Row[]).map(withId) : withId(payload as Row)
          const result = hooks.onInsert ? hooks.onInsert(insertPayload) : { data: insertPayload, error: null }
          if (!result.error) rows.push(...(Array.isArray(insertPayload) ? insertPayload : [insertPayload]))
          resolve(result)
        } else if (mode === 'delete') {
          const result = hooks.onDelete ? hooks.onDelete() : { data: null, error: null }
          if (!result.error) { for (const [c, v] of filters) rows = rows.filter(r => r[c] !== v) }
          resolve(result)
        } else if (mode === 'upsert') {
          const result = hooks.onUpsert ? hooks.onUpsert(payload) : { data: payload, error: null }
          if (!result.error) rows.push(payload as Row)
          resolve(result)
        }
      },
    }
    return q
  }
  return { build }
}

function makeStorageBucket(calls: Array<{ op: string; path?: string; opts?: unknown; paths?: string[] }>, opts: { failUpload?: boolean; failRemove?: boolean } = {}) {
  return {
    async upload(path: string, _file: unknown, uploadOpts: unknown) {
      calls.push({ op: 'upload', path, opts: uploadOpts })
      if (opts.failUpload) return { data: null, error: { message: 'upload failed' } }
      return { data: { path }, error: null }
    },
    async createSignedUrl(path: string, expiresIn: number) {
      calls.push({ op: 'createSignedUrl', path, opts: expiresIn })
      return { data: { signedUrl: `https://signed.example/${path}` }, error: null }
    },
    async remove(paths: string[]) {
      calls.push({ op: 'remove', paths })
      if (opts.failRemove) return { data: null, error: { message: 'remove failed' } }
      return { data: null, error: null }
    },
  }
}

function makeFakeClient(config: {
  itemChecks?: Row[]
  bookingState?: Row[]
  attachments?: Row[]
  dayNotes?: Row[]
  failInsert?: boolean
  failUpsert?: boolean
  failUpload?: boolean
} = {}) {
  const calls: Call[] = []
  const storageCalls: Array<{ op: string; path?: string; opts?: unknown; paths?: string[] }> = []
  const tables = {
    item_checks: makeTable('item_checks', config.itemChecks ?? [], calls, {
      onInsert: config.failInsert ? () => ({ data: null, error: { message: 'insert failed' } }) : undefined,
    }),
    booking_state: makeTable('booking_state', config.bookingState ?? [], calls, {}),
    attachments: makeTable('attachments', config.attachments ?? [], calls, {}),
    day_notes: makeTable('day_notes', config.dayNotes ?? [], calls, {
      onUpsert: config.failUpsert ? () => ({ data: null, error: { message: 'upsert failed' } }) : undefined,
    }),
  }
  const bucket = makeStorageBucket(storageCalls, { failUpload: config.failUpload })
  const client = {
    from(table: keyof typeof tables) { return tables[table].build() },
    storage: { from: () => bucket },
  }
  return { client: client as unknown as SupabaseClient, calls, storageCalls }
}

test('useChecks: toggle inserts then deletes, Set reflects it', async () => {
  const { client, calls } = makeFakeClient()
  const { result } = renderHook(() => useChecks('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.done.has('valle/T01')).toBe(false)

  await act(async () => { await result.current.toggle('valle/T01') })
  expect(result.current.done.has('valle/T01')).toBe(true)
  expect(calls.some(c => c.table === 'item_checks' && c.mode === 'insert')).toBe(true)

  await act(async () => { await result.current.toggle('valle/T01') })
  expect(result.current.done.has('valle/T01')).toBe(false)
  expect(calls.some(c => c.table === 'item_checks' && c.mode === 'delete')).toBe(true)
})

test('useChecks: two rapid toggles of the same id take opposite actions', async () => {
  const { client, calls } = makeFakeClient()
  const { result } = renderHook(() => useChecks('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await Promise.all([result.current.toggle('valle/x'), result.current.toggle('valle/x')])
  })

  const itemCheckCalls = calls.filter(c => c.table === 'item_checks' && c.mode !== 'select')
  expect(itemCheckCalls.map(c => c.mode)).toEqual(['insert', 'delete'])
  expect(result.current.done.has('valle/x')).toBe(false)
})

test('useChecks: a failing insert reverts the optimistic Set and rejects', async () => {
  const { client } = makeFakeClient({ failInsert: true })
  const { result } = renderHook(() => useChecks('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await act(async () => {
    await expect(result.current.toggle('valle/T01')).rejects.toThrow()
  })
  expect(result.current.done.has('valle/T01')).toBe(false)
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

test('useBookingState: save upserts with onConflict trip,booking_id and merges', async () => {
  const { client, calls } = makeFakeClient()
  const { result } = renderHook(() => useBookingState('valle', client))
  await waitFor(() => expect(result.current.state).toBeDefined())

  await act(async () => { await result.current.save('T01', { status: 'booked', cost: 12.5 }) })
  const upsertCall = calls.find(c => c.table === 'booking_state' && c.mode === 'upsert')
  expect(upsertCall?.upsertOpts).toEqual({ onConflict: 'trip,booking_id' })
  expect(result.current.state.T01.status).toBe('booked')
  expect(result.current.state.T01.cost).toBe(12.5)
  expect(result.current.state.T01.trip).toBe('valle')
})

test('useAttachments: upload rejects a 30 MB PDF without touching storage', async () => {
  const { client, storageCalls } = makeFakeClient()
  const { result } = renderHook(() => useAttachments('valle', 'T01', 'owner-1', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  const bigFile = { name: 'big.pdf', type: 'application/pdf', size: 30 * 1024 * 1024 } as File
  await expect(result.current.upload(bigFile)).rejects.toThrow(/25 MB/)
  expect(storageCalls.length).toBe(0)
})

test('useAttachments: upload rejects a text file without touching storage', async () => {
  const { client, storageCalls } = makeFakeClient()
  const { result } = renderHook(() => useAttachments('valle', 'T01', 'owner-1', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  const txtFile = new File([new Uint8Array(10)], 'notes.txt', { type: 'text/plain' })
  await act(async () => {
    await expect(result.current.upload(txtFile)).rejects.toThrow(/PDF or image/)
  })
  expect(storageCalls.length).toBe(0)
  expect(result.current.error).toMatch(/PDF or image/)
})

test('useAttachments: a valid PDF uploads to storage with expected path then inserts a row', async () => {
  const { client, storageCalls, calls } = makeFakeClient()
  const { result } = renderHook(() => useAttachments('valle', 'T01', 'owner-1', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  const file = new File([new Uint8Array(1024)], 'my ticket.pdf', { type: 'application/pdf' })
  await act(async () => { await result.current.upload(file) })

  const uploadCall = storageCalls.find(c => c.op === 'upload')
  expect(uploadCall?.path).toMatch(/^owner-1\/valle\/T01\/\d+-my_ticket\.pdf$/)
  expect(uploadCall?.opts).toEqual({ contentType: 'application/pdf', upsert: false })

  const insertCall = calls.find(c => c.table === 'attachments' && c.mode === 'insert')
  expect(insertCall).toBeTruthy()
  expect(result.current.list.length).toBe(1)
  expect(result.current.list[0].filename).toBe('my ticket.pdf')
})

test('useAttachments: url returns a signed url and remove deletes storage object then row', async () => {
  const { client, calls } = makeFakeClient()
  const { result } = renderHook(() => useAttachments('valle', 'T01', 'owner-1', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  const file = new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' })
  await act(async () => { await result.current.upload(file) })
  const attachment = result.current.list[0]
  expect(attachment.id).toMatch(/^fake-\d+$/)

  const signedUrl = await result.current.url(attachment)
  expect(signedUrl).toContain(attachment.storage_path)

  await act(async () => { await result.current.remove(attachment) })
  expect(result.current.list.length).toBe(0)

  const deleteCall = calls.find(c => c.table === 'attachments' && c.mode === 'delete')
  expect(deleteCall?.filters).toEqual([['id', attachment.id]])
})

test('useDayNotes: loads the existing row for (trip, date)', async () => {
  const { client } = makeFakeClient({
    dayNotes: [
      { trip: 'valle', date: '2026-11-02', text: 'ferry at 9', saved_places: [{ id: 'p1', name: 'Bar Uno', lat: 1, lng: 2, saved_at: '2026-11-02T08:00:00.000Z' }] },
      { trip: 'valle', date: '2026-11-03', text: 'other day', saved_places: [] },
    ],
  })
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.note).toBe('ferry at 9')
  expect(result.current.savedPlaces.map(p => p.id)).toEqual(['p1'])
})

test('useDayNotes: savePlace upserts an array containing the new place', async () => {
  const { client, calls } = makeFakeClient()
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  const place: SavedPlace = { id: 'p9', name: 'Pasticceria', lat: 38.7, lng: -9.1, saved_at: '2026-11-02T10:00:00.000Z' }
  await act(async () => { await result.current.savePlace(place) })

  const upsertCall = calls.find(c => c.table === 'day_notes' && c.mode === 'upsert')
  expect(upsertCall?.upsertOpts).toEqual({ onConflict: 'trip,date' })
  const payload = upsertCall?.payload as { trip: string; date: string; saved_places: SavedPlace[] }
  expect(payload.trip).toBe('valle')
  expect(payload.date).toBe('2026-11-02')
  expect(payload.saved_places).toEqual([place])
  expect(result.current.savedPlaces).toEqual([place])
})

test('useDayNotes: savePlace is idempotent for an id already saved', async () => {
  const existing = { id: 'p1', name: 'Bar Uno', lat: 1, lng: 2, saved_at: '2026-11-02T08:00:00.000Z' }
  const { client, calls } = makeFakeClient({
    dayNotes: [{ trip: 'valle', date: '2026-11-02', text: '', saved_places: [existing] }],
  })
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => { await result.current.savePlace({ ...existing, saved_at: 'later' }) })

  expect(calls.filter(c => c.table === 'day_notes' && c.mode === 'upsert')).toHaveLength(0)
  expect(result.current.savedPlaces).toEqual([existing])
})

test('useDayNotes: removePlace upserts the remaining array', async () => {
  const a = { id: 'p1', name: 'A', lat: 1, lng: 2, saved_at: 'x' }
  const b = { id: 'p2', name: 'B', lat: 3, lng: 4, saved_at: 'y' }
  const { client, calls } = makeFakeClient({
    dayNotes: [{ trip: 'valle', date: '2026-11-02', text: '', saved_places: [a, b] }],
  })
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => { await result.current.removePlace('p1') })

  const upsertCall = calls.find(c => c.table === 'day_notes' && c.mode === 'upsert')
  expect((upsertCall?.payload as { saved_places: SavedPlace[] }).saved_places).toEqual([b])
  expect(result.current.savedPlaces).toEqual([b])
})

test('useDayNotes: a failing savePlace reverts the optimistic list and rejects', async () => {
  const { client } = makeFakeClient({ failUpsert: true })
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await act(async () => {
    await expect(result.current.savePlace({ id: 'p9', name: 'X', lat: 0, lng: 0, saved_at: 'z' })).rejects.toThrow()
  })
  expect(result.current.savedPlaces).toEqual([])
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

test('useDayNotes: setNote is optimistic and upserts once after the 800 ms debounce', async () => {
  vi.useFakeTimers()
  try {
    const { client, calls } = makeFakeClient()
    const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
    // The initial load now also reads the outbox from IndexedDB, which needs a few
    // ticks of the fake clock before `loading` can go false.
    await act(async () => { await vi.advanceTimersByTimeAsync(LOAD_MS) })
    expect(result.current.loading).toBe(false)

    act(() => { result.current.setNote('a') })
    act(() => { result.current.setNote('ab') })
    expect(result.current.note).toBe('ab')
    expect(calls.filter(c => c.table === 'day_notes' && c.mode === 'upsert')).toHaveLength(0)

    await act(async () => { await vi.advanceTimersByTimeAsync(800) })

    const upserts = calls.filter(c => c.table === 'day_notes' && c.mode === 'upsert')
    expect(upserts).toHaveLength(1)
    expect((upserts[0].payload as { text: string }).text).toBe('ab')
  } finally {
    vi.useRealTimers()
  }
})

// A client whose day_notes SELECT stays pending until released, so a write can be
// observed while the hook is still loading.
function makeSlowDayNotesClient(existing: Row, opts: { failUpsert?: boolean } = {}) {
  const upserts: Record<string, unknown>[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const client = {
    from() {
      let mode: 'select' | 'upsert' = 'select'
      let payload: Record<string, unknown> | undefined
      const q: Record<string, unknown> = {
        select() { return q },
        eq() { return q },
        upsert(p: Record<string, unknown>) { mode = 'upsert'; payload = p; return q },
        then(resolve: (r: Res<unknown>) => void) {
          if (mode === 'upsert') {
            upserts.push(payload!)
            resolve(opts.failUpsert ? { data: null, error: { message: 'upsert failed' } } : { data: null, error: null })
            return
          }
          void gate.then(() => resolve({ data: [existing], error: null }))
        },
      }
      return q
    },
  }
  return { client: client as unknown as SupabaseClient, upserts, release }
}

test('useDayNotes: savePlace before the initial load resolves never sends text', async () => {
  const { client, upserts, release } = makeSlowDayNotesClient({
    trip: 'valle', date: '2026-11-02', text: 'do not clobber me', saved_places: [],
  })
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  expect(result.current.loading).toBe(true)

  const place: SavedPlace = { id: 'p9', name: 'Pasticceria', lat: 1, lng: 2, saved_at: 'now' }
  await act(async () => { await result.current.savePlace(place) })

  expect(upserts).toHaveLength(1)
  expect(upserts[0]).not.toHaveProperty('text')
  expect(upserts[0].saved_places).toEqual([place])

  // The late load must not overwrite the edit the user already made.
  await act(async () => { release(); await Promise.resolve() })
  expect(result.current.savedPlaces).toEqual([place])
})

test('useDayNotes: setNote upserts only text, never saved_places', async () => {
  vi.useFakeTimers()
  try {
    const { client, calls } = makeFakeClient({
      dayNotes: [{ trip: 'valle', date: '2026-11-02', text: '', saved_places: [{ id: 'p1', name: 'A', lat: 1, lng: 2, saved_at: 'x' }] }],
    })
    const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
    // The initial load now also reads the outbox from IndexedDB, which needs a few
    // ticks of the fake clock before `loading` can go false.
    await act(async () => { await vi.advanceTimersByTimeAsync(LOAD_MS) })

    act(() => { result.current.setNote('ferry at 9') })
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })

    const upsert = calls.find(c => c.table === 'day_notes' && c.mode === 'upsert')!
    expect(upsert.payload).not.toHaveProperty('saved_places')
    expect((upsert.payload as { text: string }).text).toBe('ferry at 9')
  } finally {
    vi.useRealTimers()
  }
})

test('useDayNotes: unmounting with a pending note flushes it instead of dropping it', async () => {
  vi.useFakeTimers()
  try {
    const { client, calls } = makeFakeClient()
    const { result, unmount } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
    await act(async () => { await vi.advanceTimersByTimeAsync(LOAD_MS) })

    act(() => { result.current.setNote('half typed') })
    expect(calls.filter(c => c.table === 'day_notes' && c.mode === 'upsert')).toHaveLength(0)

    await act(async () => { unmount(); await vi.advanceTimersByTimeAsync(0) })

    const upserts = calls.filter(c => c.table === 'day_notes' && c.mode === 'upsert')
    expect(upserts).toHaveLength(1)
    expect((upserts[0].payload as { text: string }).text).toBe('half typed')
  } finally {
    vi.useRealTimers()
  }
})

test('useDayNotes: changing the date flushes the previous day’s pending note once', async () => {
  vi.useFakeTimers()
  try {
    const { client, calls } = makeFakeClient()
    const { result, rerender } = renderHook(({ date }) => useDayNotes('valle', date, client), {
      initialProps: { date: '2026-11-02' },
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(LOAD_MS) })

    act(() => { result.current.setNote('monday note') })
    await act(async () => { rerender({ date: '2026-11-03' }); await vi.advanceTimersByTimeAsync(LOAD_MS) })

    const upserts = calls.filter(c => c.table === 'day_notes' && c.mode === 'upsert')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].payload).toMatchObject({ date: '2026-11-02', text: 'monday note' })

    // The flushed timer must not fire a second time.
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(calls.filter(c => c.table === 'day_notes' && c.mode === 'upsert')).toHaveLength(1)
  } finally {
    vi.useRealTimers()
  }
})

test('useDayNotes: a savePlace that fails mid-load lets the pending select apply server places', async () => {
  const serverPlace = { id: 'server-1', name: 'From the server', lat: 5, lng: 6, saved_at: 's' }
  const { client, release } = makeSlowDayNotesClient(
    { trip: 'valle', date: '2026-11-02', text: 'server note', saved_places: [serverPlace] },
    { failUpsert: true },
  )
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  expect(result.current.loading).toBe(true)

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await act(async () => {
    await expect(result.current.savePlace({ id: 'p9', name: 'X', lat: 1, lng: 2, saved_at: 'now' })).rejects.toThrow()
  })
  expect(result.current.savedPlaces).toEqual([])

  // The load also reads the outbox before it applies anything, so wait for it to land.
  act(() => { release() })
  await waitFor(() => expect(result.current.savedPlaces).toEqual([serverPlace]))

  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

test('useDayNotes: an unsent note survives the load while server places still land', async () => {
  const serverPlace = { id: 'server-1', name: 'From the server', lat: 5, lng: 6, saved_at: 's' }
  const { client, release } = makeSlowDayNotesClient({
    trip: 'valle', date: '2026-11-02', text: 'server', saved_places: [serverPlace],
  })
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  expect(result.current.loading).toBe(true)

  act(() => { result.current.setNote('draft') })
  act(() => { release() })
  await waitFor(() => expect(result.current.savedPlaces).toEqual([serverPlace]))

  expect(result.current.note).toBe('draft')
})

test('useDayNotes: an empty date is not a query — it keeps the empty state and stops loading', async () => {
  const { client, calls } = makeFakeClient({
    dayNotes: [{ trip: 'valle', date: '2026-11-02', text: 'ferry at 9', saved_places: [] }],
  })
  const { result } = renderHook(() => useDayNotes('valle', '', client))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(calls.filter(c => c.table === 'day_notes')).toEqual([])
  expect(result.current.note).toBe('')
  expect(result.current.savedPlaces).toEqual([])
})

test('useDayNotes: an empty trip is not a query either', async () => {
  const { client, calls } = makeFakeClient()
  const { result } = renderHook(() => useDayNotes('', '2026-11-02', client))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(calls.filter(c => c.table === 'day_notes')).toEqual([])
})

test('useDayNotes: changing the day clears the previous day’s places before the new load lands', async () => {
  const byDate: Record<string, SavedPlace[]> = {
    '2026-11-02': [{ id: 'p1', name: 'Bar Uno', lat: 1, lng: 2, saved_at: '2026-11-02T08:00:00.000Z' }],
    '2026-11-03': [{ id: 'p2', name: 'Bar Due', lat: 3, lng: 4, saved_at: '2026-11-03T08:00:00.000Z' }],
  }
  let release: (() => void) | null = null
  // Hand-rolled so the second day's load can be held open: the point of the test is the
  // window between the key changing and the new row arriving.
  const client = {
    from: () => {
      let date = ''
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: unknown) => { if (col === 'date') date = String(val); return q },
        then: (resolve: (r: { data: unknown[]; error: null }) => void) => {
          const payload = {
            data: [{ trip: 'valle', date, text: `note ${date}`, saved_places: byDate[date] ?? [] }],
            error: null,
          }
          if (date === '2026-11-03') { release = () => resolve(payload); return }
          resolve(payload)
        },
      }
      return q
    },
  } as unknown as SupabaseClient

  const { result, rerender } = renderHook(({ date }) => useDayNotes('valle', date, client), {
    initialProps: { date: '2026-11-02' },
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.savedPlaces.map(p => p.id)).toEqual(['p1'])

  rerender({ date: '2026-11-03' })

  // The new load has not resolved yet — yesterday's chips must already be gone.
  expect(result.current.loading).toBe(true)
  expect(result.current.savedPlaces).toEqual([])
  expect(result.current.note).toBe('')

  // `await thenable` reaches .then on a microtask, so the query only starts after the
  // clear above — which is the point. Let it start, then let it land.
  await waitFor(() => expect(release).not.toBeNull())
  await act(async () => { release!() })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.savedPlaces.map(p => p.id)).toEqual(['p2'])
})

// ---- offline writes go to the outbox ---------------------------------------

test('useChecks: an offline toggle enqueues, keeps the tick and never calls the client', async () => {
  const { client, calls } = makeFakeClient()
  const { result } = renderHook(() => useChecks('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = calls.length

  goOffline()
  let outcome: { queued: boolean } | undefined
  await act(async () => { outcome = await result.current.toggle('valle/T01') })

  expect(outcome).toEqual({ queued: true })
  expect(result.current.done.has('valle/T01')).toBe(true)
  expect(calls.length).toBe(before)

  const ops = await listOutbox()
  expect(ops).toHaveLength(1)
  expect(ops[0].kind).toBe('check_set')
  expect(ops[0].key).toBe('check:valle/T01')
  expect(ops[0].payload as CheckSetPayload).toEqual({ itemId: 'valle/T01', done: true })
})

test('useChecks: a network TypeError from the client enqueues instead of reverting', async () => {
  const calls: string[] = []
  const client = {
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q, like: () => q, eq: () => q, delete: () => q,
        insert: () => { calls.push('insert'); throw new TypeError('Failed to fetch') },
        then: (resolve: (r: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
      }
      return q
    },
  } as unknown as SupabaseClient

  const { result } = renderHook(() => useChecks('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  let outcome: { queued: boolean } | undefined
  await act(async () => { outcome = await result.current.toggle('valle/T01') })

  expect(calls).toEqual(['insert'])
  expect(outcome).toEqual({ queued: true })
  expect(result.current.done.has('valle/T01')).toBe(true)
  expect((await listOutbox()).map(o => o.kind)).toEqual(['check_set'])
})

test('useChecks: a non-network error still reverts, rejects and queues nothing', async () => {
  const { client } = makeFakeClient({ failInsert: true })
  const { result } = renderHook(() => useChecks('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await act(async () => { await expect(result.current.toggle('valle/T01')).rejects.toThrow() })
  warn.mockRestore()

  expect(result.current.done.has('valle/T01')).toBe(false)
  expect(await listOutbox()).toHaveLength(0)
})

test('useChecks: a fresh mount overlays a pending tick the server has not seen', async () => {
  goOffline()
  const first = makeFakeClient()
  const { result, unmount } = renderHook(() => useChecks('valle', first.client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { await result.current.toggle('valle/T01') })
  unmount()

  // A second mount whose fetch returns nothing: the tick has to come back off the outbox.
  const second = makeFakeClient()
  const { result: reloaded } = renderHook(() => useChecks('valle', second.client))
  await waitFor(() => expect(reloaded.current.loading).toBe(false))
  await waitFor(() => expect(reloaded.current.done.has('valle/T01')).toBe(true))
})

test('useChecks: a pending untick hides a row the server still has', async () => {
  await enqueue({ key: 'check:valle/T01', kind: 'check_set', payload: { itemId: 'valle/T01', done: false } })
  const { client } = makeFakeClient({ itemChecks: [{ item_id: 'valle/T01' }] })
  const { result } = renderHook(() => useChecks('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.done.has('valle/T01')).toBe(false)
})

test('useBookingState: an offline save enqueues booking_state and keeps the optimistic row', async () => {
  const { client, calls } = makeFakeClient()
  const { result } = renderHook(() => useBookingState('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = calls.length

  goOffline()
  let outcome: { queued: boolean } | undefined
  await act(async () => { outcome = await result.current.save('T01', { status: 'booked', cost: 12.5 }) })

  expect(outcome).toEqual({ queued: true })
  expect(calls.length).toBe(before)
  expect(result.current.state.T01.status).toBe('booked')

  const ops = await listOutbox()
  expect(ops).toHaveLength(1)
  expect(ops[0].kind).toBe('booking_state')
  expect(ops[0].key).toBe('booking:valle:T01')
  expect(ops[0].payload).toMatchObject({ trip: 'valle', booking_id: 'T01', status: 'booked', cost: 12.5 })
})

test('useBookingState: a fresh mount merges a pending save over the server row', async () => {
  await enqueue({
    key: 'booking:valle:T01',
    kind: 'booking_state',
    payload: { trip: 'valle', booking_id: 'T01', status: 'confirmed', updated_at: '2026-09-15T00:00:00.000Z' },
  })
  const { client } = makeFakeClient({
    bookingState: [{ trip: 'valle', booking_id: 'T01', status: 'booked', cost: 9, confirmation_ref: 'ABC', currency: 'EUR', notes: null, updated_at: '2026-09-01T00:00:00.000Z' }],
  })
  const { result } = renderHook(() => useBookingState('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.state.T01.status).toBe('confirmed')
  // Fields the pending op did not touch still come from the server.
  expect(result.current.state.T01.confirmation_ref).toBe('ABC')
})

test('useAttachments: an offline upload enqueues the blob and shows a pending row', async () => {
  const { client, storageCalls } = makeFakeClient()
  const { result } = renderHook(() => useAttachments('valle', 'T01', 'owner-1', client))
  await waitFor(() => expect(result.current.loading).toBe(false))

  goOffline()
  const file = new File([new Uint8Array(1024)], 'ticket.pdf', { type: 'application/pdf' })
  let outcome: { queued: boolean } | undefined
  await act(async () => { outcome = await result.current.upload(file) })

  expect(outcome).toEqual({ queued: true })
  expect(storageCalls.length).toBe(0)
  expect(result.current.list).toHaveLength(1)
  expect(result.current.list[0].pendingUpload).toBe(true)
  expect(result.current.list[0].filename).toBe('ticket.pdf')

  const ops = await listOutbox()
  expect(ops).toHaveLength(1)
  expect(ops[0].kind).toBe('attachment_upload')
  const payload = ops[0].payload as AttachmentUploadPayload
  expect(payload.blob).toBeInstanceOf(Blob)
  expect(await payload.blob.text()).toHaveLength(1024)
  expect(payload.path).toMatch(/^owner-1\/valle\/T01\/\d+-ticket\.pdf$/)
  expect(ops[0].key).toBe(payload.path)
})

test('useAttachments: a fresh mount lists a queued upload, and remove drops the op', async () => {
  const blob = new Blob([new Uint8Array(4)], { type: 'application/pdf' })
  await enqueue({
    key: 'owner-1/valle/T01/1-queued.pdf',
    kind: 'attachment_upload',
    payload: { trip: 'valle', bookingId: 'T01', ownerId: 'owner-1', path: 'owner-1/valle/T01/1-queued.pdf', filename: 'queued.pdf', mime: 'application/pdf', size: 4, blob },
  })
  const { client } = makeFakeClient()
  const { result } = renderHook(() => useAttachments('valle', 'T01', 'owner-1', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await waitFor(() => expect(result.current.list).toHaveLength(1))
  expect(result.current.list[0].pendingUpload).toBe(true)
  expect(result.current.list[0].id).toBe('pending:owner-1/valle/T01/1-queued.pdf')

  await act(async () => { await result.current.remove(result.current.list[0]) })
  expect(result.current.list).toHaveLength(0)
  expect(await listOutbox()).toHaveLength(0)
})

test('useDayNotes: an offline savePlace enqueues day_notes with the saved_places patch', async () => {
  const { client, calls } = makeFakeClient()
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = calls.length

  goOffline()
  const place: SavedPlace = { id: 'p1', name: 'Bar Uno', lat: 1, lng: 2, saved_at: '2026-11-02T08:00:00.000Z' }
  let outcome: { queued: boolean } | undefined
  await act(async () => { outcome = await result.current.savePlace(place) })

  expect(outcome).toEqual({ queued: true })
  expect(calls.length).toBe(before)
  expect(result.current.savedPlaces.map(p => p.id)).toEqual(['p1'])

  const ops = await listOutbox()
  expect(ops).toHaveLength(1)
  expect(ops[0].kind).toBe('day_notes')
  expect(ops[0].key).toBe('notes:valle:2026-11-02:saved_places')
  const payload = ops[0].payload as DayNotesPayload
  expect(payload.trip).toBe('valle')
  expect(payload.date).toBe('2026-11-02')
  expect(payload.patch.saved_places).toEqual([place])
})

test('useDayNotes: a fresh mount overlays a pending note and pending places', async () => {
  await enqueue({ key: 'notes:valle:2026-11-02:text', kind: 'day_notes', payload: { trip: 'valle', date: '2026-11-02', patch: { text: 'queued note' } } })
  await enqueue({ key: 'notes:valle:2026-11-02:saved_places', kind: 'day_notes', payload: { trip: 'valle', date: '2026-11-02', patch: { saved_places: [{ id: 'p9', name: 'Queued', lat: 1, lng: 2, saved_at: '2026-11-02T09:00:00.000Z' }] } } })
  const { client } = makeFakeClient({ dayNotes: [{ trip: 'valle', date: '2026-11-02', text: 'server note', saved_places: [], updated_at: '2026-09-01T00:00:00.000Z' }] })
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.note).toBe('queued note')
  expect(result.current.savedPlaces.map(p => p.id)).toEqual(['p9'])
})

// ---- a failed read is when the overlay matters most ------------------------

/**
 * A client whose every request fails the way an offline `fetch` does. Reads matter here;
 * writes are recorded so a test can prove none were attempted.
 */
// Hold the returned client in a const: a fresh one per render changes the hooks'
// effect dependency every render and spins forever.
function makeOfflineReadClient(seen: string[] = []) {
  const client = {
    from() {
      let mode = 'select'
      const q: Record<string, unknown> = {
        select() { return q },
        order() { return q },
        eq() { return q },
        like() { return q },
        single() { return q },
        insert() { mode = 'insert'; return q },
        delete() { mode = 'delete'; return q },
        upsert() { mode = 'upsert'; return q },
        then(resolve: (r: Res<unknown>) => void) {
          seen.push(mode)
          resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } })
        },
      }
      return q
    },
    storage: { from: () => makeStorageBucket([]) },
  }
  return client as unknown as SupabaseClient
}

test('useChecks: a failed read still shows the pending tick', async () => {
  await enqueue({ key: 'check:valle/T01', kind: 'check_set', payload: { itemId: 'valle/T01', done: true } })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const client = makeOfflineReadClient()
  const { result } = renderHook(() => useChecks('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.done.has('valle/T01')).toBe(true)
  warn.mockRestore()
})

test('useBookingState: a failed read still shows the pending booking edit', async () => {
  await enqueue({
    key: 'booking:valle:T01',
    kind: 'booking_state',
    payload: { trip: 'valle', booking_id: 'T01', status: 'booked', updated_at: '2026-09-15T00:00:00.000Z' },
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const client = makeOfflineReadClient()
  const { result } = renderHook(() => useBookingState('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.state.T01?.status).toBe('booked')
  warn.mockRestore()
})

test('useDayNotes: a failed read still shows the pending saved place', async () => {
  const place = { id: 'p1', name: 'Bar Uno', lat: 1, lng: 2, saved_at: '2026-11-02T08:00:00.000Z' }
  await enqueue({
    key: 'notes:valle:2026-11-02:saved_places',
    kind: 'day_notes',
    payload: { trip: 'valle', date: '2026-11-02', patch: { saved_places: [place] } },
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const client = makeOfflineReadClient()
  const { result } = renderHook(() => useDayNotes('valle', '2026-11-02', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.savedPlaces.map(p => p.id)).toEqual(['p1'])
  warn.mockRestore()
})

test('useAttachments: a failed read still lists the queued upload', async () => {
  const blob = new Blob([new Uint8Array(4)], { type: 'application/pdf' })
  await enqueue({
    key: 'owner-1/valle/T01/1-queued.pdf',
    kind: 'attachment_upload',
    payload: { trip: 'valle', bookingId: 'T01', ownerId: 'owner-1', path: 'owner-1/valle/T01/1-queued.pdf', filename: 'queued.pdf', mime: 'application/pdf', size: 4, blob },
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const client = makeOfflineReadClient()
  const { result } = renderHook(() => useAttachments('valle', 'T01', 'owner-1', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await waitFor(() => expect(result.current.list).toHaveLength(1))
  expect(result.current.list[0].pendingUpload).toBe(true)
  warn.mockRestore()
})

// ---- a live write supersedes what is queued under the same key -------------

test('useChecks: a successful online untick drops the stale queued tick for that item', async () => {
  await enqueue({ key: 'check:valle/T01', kind: 'check_set', payload: { itemId: 'valle/T01', done: true } })
  const { client, calls } = makeFakeClient({ itemChecks: [{ item_id: 'valle/T01' }] })
  const { result } = renderHook(() => useChecks('valle', client))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.done.has('valle/T01')).toBe(true)

  await act(async () => { await result.current.toggle('valle/T01') })

  expect(result.current.done.has('valle/T01')).toBe(false)
  // Without superseding, the queued done:true would be flushed straight back in.
  await waitFor(async () => expect(await listOutbox()).toHaveLength(0))
  expect(calls.filter(c => c.table === 'item_checks' && c.mode === 'insert')).toHaveLength(0)
})

// ---- blob URLs are not leaked ---------------------------------------------

test('useAttachments: removing a pending row revokes the blob URL it handed out', async () => {
  if (!URL.createObjectURL) Object.defineProperty(URL, 'createObjectURL', { value: () => '', configurable: true, writable: true })
  if (!URL.revokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true, writable: true })
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:queued')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  try {
    const blob = new Blob([new Uint8Array(4)], { type: 'application/pdf' })
    await enqueue({
      key: 'owner-1/valle/T01/1-queued.pdf',
      kind: 'attachment_upload',
      payload: { trip: 'valle', bookingId: 'T01', ownerId: 'owner-1', path: 'owner-1/valle/T01/1-queued.pdf', filename: 'queued.pdf', mime: 'application/pdf', size: 4, blob },
    })
    const { client } = makeFakeClient()
    const { result } = renderHook(() => useAttachments('valle', 'T01', 'owner-1', client))
    await waitFor(() => expect(result.current.list).toHaveLength(1))

    // The same row asked for twice hands back one URL, not two.
    let first = ''
    await act(async () => { first = await result.current.url(result.current.list[0]) })
    await act(async () => { await result.current.url(result.current.list[0]) })
    expect(first).toBe('blob:queued')
    expect(create).toHaveBeenCalledTimes(1)
    expect(revoke).not.toHaveBeenCalled()

    await act(async () => { await result.current.remove(result.current.list[0]) })
    expect(revoke).toHaveBeenCalledWith('blob:queued')
  } finally {
    create.mockRestore()
    revoke.mockRestore()
  }
})

// ---- a broken outbox must not wedge the screen -----------------------------

test('useChecks: a rejected outbox read stops loading instead of wedging on “Loading…”', async () => {
  const spy = vi.spyOn(outbox, 'listOutbox').mockRejectedValue(new Error('IndexedDB is gone'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const { client } = makeFakeClient()
    const { result } = renderHook(() => useChecks('valle', client))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(warn).toHaveBeenCalled()
  } finally {
    warn.mockRestore()
    spy.mockRestore()
  }
})

test('useBookingState: a save made while the read is still in flight survives it', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const upserts: unknown[] = []
  const client = {
    from() {
      let mode = 'select'
      let payload: unknown
      const q: Record<string, unknown> = {
        select() { return q },
        eq() { return q },
        upsert(p: unknown) { mode = 'upsert'; payload = p; return q },
        then(resolve: (r: Res<unknown>) => void) {
          if (mode === 'upsert') { upserts.push(payload); resolve({ data: null, error: null }); return }
          void gate.then(() => resolve({ data: [], error: null }))
        },
      }
      return q
    },
  } as unknown as SupabaseClient

  const { result } = renderHook(() => useBookingState('valle', client))
  expect(result.current.loading).toBe(true)

  await act(async () => { await result.current.save('T01', { status: 'booked' }) })
  expect(result.current.state.T01.status).toBe('booked')

  act(() => { release() })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(upserts).toHaveLength(1)
  // The empty server response must not wipe the save that overtook it.
  expect(result.current.state.T01?.status).toBe('booked')
})

test('useChecks: a toggle made while the read is still in flight survives it', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const client = {
    from() {
      let mode = 'select'
      const q: Record<string, unknown> = {
        select() { return q },
        like() { return q },
        eq() { return q },
        insert() { mode = 'insert'; return q },
        delete() { mode = 'delete'; return q },
        then(resolve: (r: Res<unknown>) => void) {
          if (mode !== 'select') { resolve({ data: null, error: null }); return }
          void gate.then(() => resolve({ data: [], error: null }))
        },
      }
      return q
    },
  } as unknown as SupabaseClient

  const { result } = renderHook(() => useChecks('valle', client))
  await act(async () => { await result.current.toggle('valle/T01') })
  expect(result.current.done.has('valle/T01')).toBe(true)

  act(() => { release() })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.done.has('valle/T01')).toBe(true)
})
