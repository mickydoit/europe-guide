import { useEffect, useRef, useState } from 'react'
import { QUEUED_COPY } from '../lib/state'
import type { BookingStateRow, WriteResult } from '../lib/state'
import type { BookingRow } from '../lib/types'

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '—' },
  { value: 'not_booked', label: 'Not booked' },
  { value: 'booked', label: 'Booked' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'undecided', label: 'Undecided' },
]

export function BookingForm({ booking, row, save }: {
  booking: BookingRow
  row: BookingStateRow | undefined
  save(bookingId: string, patch: Partial<Omit<BookingStateRow, 'trip' | 'booking_id' | 'updated_at'>>): Promise<WriteResult>
}) {
  const [status, setStatus] = useState(row?.status ?? '')
  const [confirmationRef, setConfirmationRef] = useState(row?.confirmation_ref ?? '')
  const [cost, setCost] = useState(row?.cost != null ? String(row.cost) : '')
  const [currency, setCurrency] = useState(row?.currency ?? 'EUR')
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveQueued, setSaveQueued] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
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

  return (
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
  )
}
