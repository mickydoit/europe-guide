import { Pill } from './Pill'
import { useSync } from '../lib/sync'

/**
 * One small pill saying whether anything is still waiting to reach the server.
 * Renders nothing at all when the outbox is empty — the quiet state is no badge.
 */
export function SyncBadge() {
  const { pending, failed, syncing } = useSync()
  if (pending + failed === 0 && !syncing) return null
  if (syncing) return <Pill tone="muted">Syncing…</Pill>
  // A parked op is the one worth shouting about, so it wins over the plain pending count.
  if (failed > 0) return <Pill tone="salmon">{failed} failed</Pill>
  return <Pill tone="columbia">{pending} to sync</Pill>
}
