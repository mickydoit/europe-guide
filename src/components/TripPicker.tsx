import type { TripRow } from '../lib/types'

export function TripPicker({ trips, active, onSelect }: {
  trips: TripRow[]
  active: string | null
  onSelect: (slug: string) => void
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
          {t.name}
        </button>
      ))}
    </div>
  )
}
