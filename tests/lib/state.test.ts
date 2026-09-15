import { renderHook, act, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useChecks, useBookingState, useAttachments } from '../../src/lib/state'

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
  failInsert?: boolean
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
