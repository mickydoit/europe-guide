/**
 * A short, persistent log of the things that could explain a bug that only happens on the
 * phone — "sometimes nothing responds to a tap" cannot be reproduced on a laptop. Restores
 * starting and ending, the page being hidden and shown, windows being opened, touches being
 * cancelled: the owner opens More and shows the last sixty lines the next time it happens.
 *
 * localStorage, so it survives iOS recreating the page. Every call is guarded: a diagnostics
 * log must never be the thing that breaks the screen.
 */
export const DIAG_KEY = 'europe-guide.diag'
const MAX_LINES = 60

function load(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DIAG_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string') : []
  } catch { return [] }
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
}

export function diag(event: string, detail?: string, now: Date = new Date()): void {
  try {
    const lines = load()
    lines.push(`${stamp(now)} ${event}${detail ? ` ${detail}` : ''}`)
    localStorage.setItem(DIAG_KEY, JSON.stringify(lines.slice(-MAX_LINES)))
  } catch { /* private mode or full storage: the log is best-effort */ }
}

export function readDiag(): string[] { return load() }

export function clearDiag(): void {
  try { localStorage.removeItem(DIAG_KEY) } catch { /* nothing to clear */ }
}
