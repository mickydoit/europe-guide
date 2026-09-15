import { renderHook, act, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useChecks, useBookingState, useAttachments, useDayNotes } from '../../src/lib/state'
import type { SavedPlace } from '../../src/lib/state'

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
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
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
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

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
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

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
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    act(() => { result.current.setNote('monday note') })
    await act(async () => { rerender({ date: '2026-11-03' }); await vi.advanceTimersByTimeAsync(0) })

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

  await act(async () => { release(); await Promise.resolve() })

  expect(result.current.savedPlaces).toEqual([serverPlace])
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
  await act(async () => { release(); await Promise.resolve() })

  expect(result.current.note).toBe('draft')
  expect(result.current.savedPlaces).toEqual([serverPlace])
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
