/**
 * Teach the test environment to keep Blobs in IndexedDB.
 *
 * fake-indexeddb clones records with the global `structuredClone`, which under
 * jsdom is Node's — and Node does not recognise a jsdom `Blob`, so it silently
 * comes back as `{}`. A real browser stores Blobs fine, so without this the
 * attachment ops would fail only in the test env. Blobs are immutable, so
 * handing the same instance back out is faithful enough.
 *
 * Import this module (for its side effect) in any test that stores a Blob.
 */
const native = globalThis.structuredClone
const PREFIX = '__blob_placeholder__'
let seq = 0

const isPlainObject = (v: unknown) => {
  if (typeof v !== 'object' || v === null) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function pack(value: unknown, held: Map<string, Blob>): unknown {
  if (value instanceof Blob) {
    const token = `${PREFIX}${seq++}`
    held.set(token, value)
    return token
  }
  if (Array.isArray(value)) return value.map(v => pack(v, held))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = pack(v, held)
    return out
  }
  return value
}

function unpack(value: unknown, held: Map<string, Blob>): unknown {
  if (typeof value === 'string' && held.has(value)) return held.get(value)
  if (Array.isArray(value)) return value.map(v => unpack(v, held))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = unpack(v, held)
    return out
  }
  return value
}

globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
  const held = new Map<string, Blob>()
  const packed = pack(value, held)
  const cloned = native(packed, options)
  return held.size ? unpack(cloned, held) : cloned
}) as typeof structuredClone

export {}
