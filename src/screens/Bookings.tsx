import { Fragment, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTrip } from '../lib/trip'
import { useAuth } from '../lib/auth'
import { useBookingState, useAttachments } from '../lib/state'
import { QUEUED_COPY } from '../lib/state'
import type { AttachmentRow, BookingStateRow, WriteResult } from '../lib/state'
import { fmtDay, fmtTime, nowInTz, todayInTrip } from '../lib/time'
import { Pill } from '../components/Pill'
import type { PillTone } from '../components/Pill'
import { Sheet } from '../components/Sheet'
import { Md } from '../components/Md'
import type { BookingRow } from '../lib/types'

const PRIORITY_TONE: Record<string, PillTone> = { critical: 'salmon', high: 'banana', medium: 'columbia', low: 'muted' }
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '—' },
  { value: 'not_booked', label: 'Not booked' },
  { value: 'booked', label: 'Booked' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'undecided', label: 'Undecided' },
]

function humanize(key: string): string {
  const words = key.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function statusInfo(status: string | null): { tone: PillTone; label: string } {
  const s = (status ?? '').toLowerCase().trim()
  if (s === 'booked' || s === 'confirmed') return { tone: 'accent', label: humanize(s) }
  if (s === 'cancelled') return { tone: 'muted', label: humanize(s) }
  if (s === 'undecided') return { tone: 'banana', label: humanize(s) }
  if (s === 'not_booked' || s === 'not booked') return { tone: 'coral', label: 'Not booked' }
  if (!status) return { tone: 'muted', label: '—' }
  return { tone: 'muted', label: status }
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} kB`
}

function isPhone(contact: string): boolean {
  return /^[+\d]/.test(contact.trim())
}

function normalisePriority(p: string): string {
  return p.trim().toLowerCase().split(/\W/)[0]
}

function BookingSheet({ booking, tripSlug, row, save, onClose }: {
  booking: BookingRow
  tripSlug: string
  row: BookingStateRow | undefined
  save(bookingId: string, patch: Partial<Omit<BookingStateRow, 'trip' | 'booking_id' | 'updated_at'>>): Promise<WriteResult>
  onClose(): void
}) {
  const { session } = useAuth()
  const ownerId = session?.user.id ?? ''
  const { list, upload, url, remove, error: attError } = useAttachments(tripSlug, booking.id, ownerId)

  const [status, setStatus] = useState(row?.status ?? '')
  const [confirmationRef, setConfirmationRef] = useState(row?.confirmation_ref ?? '')
  const [cost, setCost] = useState(row?.cost != null ? String(row.cost) : '')
  const [currency, setCurrency] = useState(row?.currency ?? 'EUR')
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveQueued, setSaveQueued] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadQueued, setUploadQueued] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uploadMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    if (uploadMsgTimer.current) clearTimeout(uploadMsgTimer.current)
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaveQueued(false)
    try {
      const result = await save(booking.id, {
        status: (status || null) as BookingStateRow['status'],
        confirmation_ref: confirmationRef || null,
        cost: cost === '' ? null : Number(cost),
        currency: currency || null,
        notes: notes || null,
      })
      // Queued and accepted are both saves as far as the owner is concerned — the copy
      // just says which one it was, so nothing looks lost when the phone has no signal.
      if (result?.queued) setSaveQueued(true)
      else setSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => { setSaved(false); setSaveQueued(false) }, 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleOpenAttachment(a: AttachmentRow) {
    // Open the window synchronously in the click handler (before any await) so iOS
    // Safari's popup blocker treats it as a direct result of the user gesture; navigate
    // it to the signed URL once that resolves.
    const w = window.open('', '_blank', 'noopener')
    try {
      const signedUrl = await url(a)
      if (w) w.location.href = signedUrl
      else window.location.assign(signedUrl)
    } catch (e) {
      if (w) w.close()
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDeleteAttachment(a: AttachmentRow) {
    if (!window.confirm(`Delete ${a.filename}?`)) return
    try {
      await remove(a)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadQueued(false)
    try {
      const result = await upload(file)
      if (result?.queued) {
        // Same lifetime as the Save message: say it, then get out of the way.
        setUploadQueued(true)
        if (uploadMsgTimer.current) clearTimeout(uploadMsgTimer.current)
        uploadMsgTimer.current = setTimeout(() => setUploadQueued(false), 2000)
      }
    } catch {
      // error already surfaced via the attachments hook's error state
    } finally {
      setUploading(false)
    }
  }

  const fieldEntries = Object.entries(booking.fields)

  return (
    <Sheet open title={booking.title} onClose={onClose}>
      <p className="sheet__meta">
        {booking.date ? fmtDay(booking.date) : '—'}
        {booking.date ? ' · ' : ''}
        {fmtTime(booking.time, null)}
      </p>

      <dl className="sheet__fields">
        {booking.address && (
          <Fragment>
            <dt>Address</dt>
            <dd>{booking.address}</dd>
          </Fragment>
        )}
        {booking.contact && (
          <Fragment>
            <dt>Contact</dt>
            <dd>
              {isPhone(booking.contact)
                ? <a href={`tel:${booking.contact.replace(/(?!^\+)[^\d]/g, '')}`}>{booking.contact}</a>
                : booking.contact}
            </dd>
          </Fragment>
        )}
        {booking.notes && (
          <Fragment>
            <dt>Notes</dt>
            <dd><Md text={booking.notes} /></dd>
          </Fragment>
        )}
        {booking.fallback && (
          <Fragment>
            <dt>Fallback</dt>
            <dd>{booking.fallback}</dd>
          </Fragment>
        )}
        {booking.options && (
          <Fragment>
            <dt>Options</dt>
            <dd>{booking.options}</dd>
          </Fragment>
        )}
        {booking.relates_to && (
          <Fragment>
            <dt>Relates to</dt>
            <dd>{booking.relates_to}</dd>
          </Fragment>
        )}
        {fieldEntries.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{humanize(k)}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>

      <div className="form booking-form">
        <div className="field">
          <label className="field__label" htmlFor="booking-status">Status</label>
          <select id="booking-status" className="field__input" value={status} onChange={e => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="booking-confirmation">Confirmation ref</label>
          <input id="booking-confirmation" className="field__input" value={confirmationRef} onChange={e => setConfirmationRef(e.target.value)} />
        </div>
        <div className="booking-form__row">
          <div className="field">
            <label className="field__label" htmlFor="booking-cost">Cost</label>
            <input id="booking-cost" type="number" className="field__input" value={cost} onChange={e => setCost(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="booking-currency">Currency</label>
            <input id="booking-currency" className="field__input" value={currency} onChange={e => setCurrency(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="booking-notes">Notes</label>
          <textarea id="booking-notes" className="field__input booking-form__textarea" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void handleSave()}>
          Save
        </button>
        {saved && <p className="form__msg form__msg--info">Saved</p>}
        {saveQueued && <p className="form__msg form__msg--queued">{QUEUED_COPY}</p>}
        {saveError && <p className="form__msg form__msg--error">{saveError}</p>}
      </div>

      {ownerId && (
        <div className="attachments">
          <h3 className="h5 attachments__heading">Attachments</h3>
          {list.length > 0 && (
            <ul className="attachments__list">
              {list.map(a => (
                <li key={a.id} className="attachments__row">
                  <button type="button" className="attachments__name" onClick={() => void handleOpenAttachment(a)}>
                    {a.filename}
                  </button>
                  <span className="attachments__size">{fmtSize(a.size)}</span>
                  {a.pendingUpload && <Pill tone="columbia">waiting to upload</Pill>}
                  <button type="button" className="attachments__delete" onClick={() => void handleDeleteAttachment(a)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="field">
            <label className="field__label" htmlFor="booking-attachment">Add PDF or photo</label>
            <input
              id="booking-attachment"
              type="file"
              accept="application/pdf,image/*"
              disabled={uploading}
              onChange={e => void handleFileChange(e)}
            />
          </div>
          {uploadQueued && <p className="form__msg form__msg--queued">{QUEUED_COPY}</p>}
          {(actionError ?? attError) && <p className="form__msg form__msg--error">{actionError ?? attError}</p>}
        </div>
      )}
    </Sheet>
  )
}

function BookingRowButton({ booking, priorityTone, overdue, meta, state, onOpen }: {
  booking: BookingRow
  priorityTone?: PillTone
  overdue?: boolean
  meta: string
  state: BookingStateRow | undefined
  onOpen(): void
}) {
  const effective = state?.status ?? booking.status_from_file ?? (booking.kind === 'booked' ? 'booked' : null)
  const info = statusInfo(effective)
  return (
    <button
      type="button"
      className={`booking-row${overdue ? ' booking-row--overdue' : ''}`}
      onClick={onOpen}
    >
      <span className="booking-row__main">
        <span className="booking-row__title">{booking.title}</span>
        {meta && <span className="booking-row__meta">{meta}</span>}
      </span>
      <span className="booking-row__pills">
        {booking.priority && priorityTone && <Pill tone={priorityTone}>{booking.priority}</Pill>}
        <Pill tone={info.tone}>{info.label}</Pill>
      </span>
    </button>
  )
}

export function Bookings() {
  const { trips, content, loading, error, refresh } = useTrip()
  const { state, save } = useBookingState(content?.trip.slug ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (loading && !content) {
    return <main className="screen"><p className="caption">Loading…</p></main>
  }
  if (error && !content) {
    return (
      <main className="screen">
        <p className="caption">{error}</p>
        <button type="button" className="btn--text" onClick={() => { void refresh() }}>Retry</button>
      </main>
    )
  }
  if (trips.length === 0) {
    return <main className="screen"><p className="caption">No trips yet. Run the import on your laptop.</p></main>
  }
  if (!content) return null

  const trip = content.trip
  const today = todayInTrip(trip) ?? nowInTz(trip.timezone).date

  const toBook = content.bookings
    .filter(b => b.kind === 'todo')
    .slice()
    .sort((a, b) => (a.book_by ?? a.decide_by ?? '9999').localeCompare(b.book_by ?? b.decide_by ?? '9999'))

  const booked = content.bookings
    .filter(b => b.kind === 'booked')
    .slice()
    .sort((a, b) => {
      const da = a.date ?? ''; const db = b.date ?? ''
      if (da !== db) return da.localeCompare(db)
      return (a.time ?? '').localeCompare(b.time ?? '')
    })

  const walkins = content.bookings.filter(b => b.kind === 'walkin')

  const selected = selectedId ? content.bookings.find(b => b.id === selectedId) ?? null : null

  return (
    <main className="screen bookings">
      <h1 className="h5">Bookings</h1>

      <section className="bookings-section">
        <h2 className="h5 bookings-section__heading">To book</h2>
        {toBook.length === 0 && <p className="caption">Nothing to book.</p>}
        {toBook.map(b => {
          const overdue = !!(b.book_by && b.book_by < today)
          const by = b.book_by ?? b.decide_by
          const meta = by ? `${b.book_by ? 'Book' : 'Decide'} by ${fmtDay(by)}` : ''
          return (
            <BookingRowButton
              key={b.id}
              booking={b}
              priorityTone={b.priority ? PRIORITY_TONE[normalisePriority(b.priority)] : undefined}
              overdue={overdue}
              meta={meta}
              state={state[b.id]}
              onOpen={() => setSelectedId(b.id)}
            />
          )
        })}
      </section>

      <section className="bookings-section">
        <h2 className="h5 bookings-section__heading">Booked</h2>
        {booked.length === 0 && <p className="caption">Nothing booked yet.</p>}
        {booked.map(b => {
          const meta = [b.date ? fmtDay(b.date) : null, b.time ? fmtTime(b.time, null) : null].filter(Boolean).join(' · ')
          return (
            <BookingRowButton
              key={b.id}
              booking={b}
              meta={meta}
              state={state[b.id]}
              onOpen={() => setSelectedId(b.id)}
            />
          )
        })}
      </section>

      {walkins.length > 0 && (
        <section className="bookings-section">
          <h2 className="h5 bookings-section__heading">Walk-in</h2>
          <p className="bookings-walkin">{walkins.map(w => w.title).join(' · ')}</p>
        </section>
      )}

      {selected && (
        <BookingSheet
          key={selected.id}
          booking={selected}
          tripSlug={trip.slug}
          row={state[selected.id]}
          save={save}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  )
}
