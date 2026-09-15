import { Md } from './Md'
import { fmtCountdown } from '../lib/time'
import type { AlertRow } from '../lib/types'

export function NowNext({ current, next, minutesToNext }: {
  current: AlertRow | null
  next: AlertRow | null
  minutesToNext: number | null
}) {
  if (!current && !next) return null
  return (
    <div className="nownext">
      {current && <p className="nownext__now"><Md text={current.text} /></p>}
      {next && (
        <p className="nownext__next">
          Next: <Md text={next.text} />
          {minutesToNext != null && ` · ${fmtCountdown(minutesToNext)}`}
        </p>
      )}
    </div>
  )
}
