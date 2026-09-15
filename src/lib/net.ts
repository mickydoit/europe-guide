/**
 * Telling "no signal" apart from "the server said no".
 *
 * Both halves of the offline path need this judgement and must agree on it: `state.ts`
 * decides whether a failed live write should be queued rather than surfaced, and `sync.ts`
 * decides whether a failed replay should count as an attempt. Keeping one copy here is what
 * keeps those two answers the same.
 */

// Word-bounded on purpose: an unbounded /load failed/ also matches "upload failed", which is
// a perfectly ordinary storage rejection and must still surface as an error, not a queued write.
const NETWORK_MESSAGE = /\bfetch\b|\bnetwork\b|Failed to fetch|NetworkError|\bload failed\b/i
/** Gateway-class statuses: the request never reached Postgres, so replaying it is safe. */
const NETWORK_STATUS = new Set([0, 502, 503, 504])

/**
 * Did this failure mean "no signal" rather than "the server said no"?
 *
 * Supabase hands back fetch failures two different ways — a thrown `TypeError` from the
 * transport, or a `{ error }` object carrying the transport's message — so both shapes land here.
 *
 * The judgement is made on the message (and status), never on the constructor. `fetch` does
 * throw a `TypeError`, but so does ordinary broken code: "Cannot read properties of null"
 * inside a replay is a bug in an op, not a tunnel. Calling that one "no signal" would hold
 * the whole queue behind an op that can never succeed and never parks.
 */
export function isNetworkFailure(e: unknown): boolean {
  const o = e as { message?: unknown; status?: unknown } | null
  if (o && typeof o.status === 'number' && NETWORK_STATUS.has(o.status)) return true
  const m = typeof o?.message === 'string' ? o.message : ''
  return NETWORK_MESSAGE.test(m)
}
