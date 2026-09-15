/**
 * jsdom has no `caches`; this is a minimal in-memory CacheStorage/Cache polyfill for tests
 * that inject `cacheStorage` (offlineMaps.ts, attachmentsCache.ts, and the hooks/components
 * built on them all take it as a parameter for exactly this reason).
 */
export class FakeCache {
  store = new Map<string, Response>()
  async put(req: Request | string, res: Response) {
    this.store.set(typeof req === 'string' ? req : req.url, res.clone())
  }
  async match(req: Request | string) {
    return this.store.get(typeof req === 'string' ? req : req.url)
  }
  async delete(req: Request | string) {
    return this.store.delete(typeof req === 'string' ? req : req.url)
  }
  async keys() {
    return [...this.store.keys()].map(k => new Request(k))
  }
}

export class FakeCacheStorage {
  caches = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache())
    return this.caches.get(name) as unknown as Cache
  }
  async delete(name: string) {
    return this.caches.delete(name)
  }
  async has(name: string) {
    return this.caches.has(name)
  }
  async keys() {
    return [...this.caches.keys()]
  }
  async match() {
    return undefined
  }
}
