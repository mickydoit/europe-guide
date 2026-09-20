import { Link } from 'react-router-dom'
import { Sheet } from './Sheet'
import { Md } from './Md'

export type MapFeatureKind = 'stop' | 'parked' | 'place'

export interface MapSheetProps {
  open: boolean
  kind: MapFeatureKind
  title: string
  subtitle: string | null
  details: string | null
  walkHref: string | null
  onClose: () => void
  /** Places only (Task 5): a lazily-loaded Places photo. */
  photoSrc?: string | null
  /** Places only (Task 5): saves the place onto the selected day's notes. */
  onSave?: () => void
  saved?: boolean
  saving?: boolean
  error?: string | null
  /** Places only: the save went to the outbox, not the server. Accent tone, not an error tone. */
  queuedMsg?: string | null
  /** Stops only: a matching booking's ticket, when one exists. */
  ticketHref?: string | null
  ticketLabel?: string
}

export function MapSheet({
  open, kind, title, subtitle, details, walkHref, onClose, photoSrc, onSave, saved, saving, error, queuedMsg, ticketHref, ticketLabel = 'Open ticket',
}: MapSheetProps) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {kind === 'place' && photoSrc && <img className="sheet__photo" loading="lazy" src={photoSrc} alt="" />}
      {subtitle && <p className="sheet__meta">{subtitle}</p>}
      {details && <Md text={details} className="sheet__meta" />}
      {walkHref && (
        <a className="btn--text" href={walkHref} target="_blank" rel="noopener noreferrer">Walk there</a>
      )}
      {ticketHref && <Link className="btn--text" to={ticketHref}>{ticketLabel}</Link>}
      {kind === 'place' && onSave && (
        <button
          type="button"
          className="btn btn--secondary"
          disabled={saved || saving}
          onClick={onSave}
        >
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save for today'}
        </button>
      )}
      {queuedMsg && <p className="form__msg form__msg--queued">{queuedMsg}</p>}
      {error && <p className="form__msg form__msg--error">{error}</p>}
    </Sheet>
  )
}
