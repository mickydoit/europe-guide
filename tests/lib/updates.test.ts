import { vi } from 'vitest'
import { setupAutoReload, checkForUpdate } from '../../src/lib/updates'

function fakeSw(opts: { controller?: object | null; reg?: { update: () => Promise<void>; installing?: object | null; waiting?: object | null } | null }) {
  const listeners: Record<string, (() => void)[]> = {}
  return {
    sw: {
      controller: opts.controller ?? null,
      addEventListener: (ev: string, fn: () => void) => { (listeners[ev] ??= []).push(fn) },
      getRegistration: async () => opts.reg ?? null,
    } as unknown as ServiceWorkerContainer,
    fire: (ev: string) => listeners[ev]?.forEach(fn => fn()),
  }
}
const doc = () => { const l: Record<string, (() => void)[]> = {}; return { doc: { visibilityState: 'visible', addEventListener: (ev: string, fn: () => void) => { (l[ev] ??= []).push(fn) } } as unknown as Pick<Document, 'addEventListener' | 'visibilityState'>, fire: (ev: string) => l[ev]?.forEach(fn => fn()) } }

test('reloads once when a new service worker takes control of an already-controlled page', () => {
  const reload = vi.fn(); const { sw, fire } = fakeSw({ controller: {} }); const d = doc()
  const stop = setupAutoReload(sw, reload, d.doc, 1e9)
  fire('controllerchange'); fire('controllerchange')
  expect(reload).toHaveBeenCalledTimes(1); stop()
})
test('does not reload on the first claim of a fresh install', () => {
  const reload = vi.fn(); const { sw, fire } = fakeSw({ controller: null }); const d = doc()
  const stop = setupAutoReload(sw, reload, d.doc, 1e9)
  fire('controllerchange'); expect(reload).not.toHaveBeenCalled(); stop()
})
test('checks for an update when the app becomes visible', async () => {
  const update = vi.fn(async () => {}); const { sw } = fakeSw({ controller: {}, reg: { update } }); const d = doc()
  const stop = setupAutoReload(sw, vi.fn(), d.doc, 1e9)
  d.fire('visibilitychange'); await Promise.resolve(); await Promise.resolve()
  expect(update).toHaveBeenCalledTimes(1); stop()
})
test('checkForUpdate reports updated / current / unavailable', async () => {
  expect(await checkForUpdate(fakeSw({ reg: { update: async () => {}, waiting: {} } }).sw)).toBe('updated')
  expect(await checkForUpdate(fakeSw({ reg: { update: async () => {} } }).sw)).toBe('current')
  expect(await checkForUpdate(fakeSw({ reg: null }).sw)).toBe('unavailable')
  expect(await checkForUpdate(undefined)).toBe('unavailable')
})
