import type { TripRow } from '../lib/types'

export function TripPicker({ trips, active, onSelect, labelFor }: {
  trips: TripRow[]
  active: string | null
  onSelect: (slug: string) => void
  /** What to print on the pill. Defaults to the trip name; Home prints the country. */
  labelFor?: (trip: TripRow) => string
}) {
  return (
    <div className="trip-picker">
      {trips.map(t => (
        <button
          key={t.slug}
          type="button"
          className={`trip-picker__pill${t.slug === active ? ' trip-picker__pill--active' : ''}`}
          onClick={() => onSelect(t.slug)}
        >
          {labelFor ? labelFor(t) : t.name}
        </button>
      ))}
    </div>
  )
}
