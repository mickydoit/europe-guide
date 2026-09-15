import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sheet } from './Sheet'
import { Md } from './Md'
import { walkLink } from '../lib/links'
import type { ItemRow } from '../lib/types'

const TONES = ['granny', 'coral', 'columbia'] as const
const MAX_CIRCLES = 3

function optionName(option: ItemRow): string {
  return option.place_name ?? option.plan
}

/** "Enoteca Piccola" -> "EP"; a single word keeps just its first letter. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join('')
}

export function OptionsCard({ heading, options, date, tripName }: {
  heading: string
  options: ItemRow[]
  date: string
  tripName: string
}) {
  const [open, setOpen] = useState<ItemRow | null>(null)
  const shown = options.slice(0, MAX_CIRCLES)

  const openName = open ? optionName(open) : ''
  const href = open
    ? walkLink({ lat: open.lat, lng: open.lng, name: openName, address: open.address }, tripName)
    : null

  return (
    <section className="options-card">
      <div className="options-card__head">
        <h2 className="h5 options-card__heading">{heading}</h2>
        <Link to={`/day/${date}`} className="btn--text options-card__all">View day</Link>
      </div>

      {shown.length === 0 ? (
        <p className="caption options-card__empty">Nothing to choose right now</p>
      ) : (
        <ul className="options-card__row">
          {shown.map((option, i) => {
            const name = optionName(option)
            return (
              <li key={option.id} className="options-card__item">
                <button
                  type="button"
                  className={`option-circle option-circle--${TONES[i % TONES.length]}`}
                  aria-label={name}
                  onClick={() => setOpen(option)}
                >
                  <span aria-hidden="true">{initials(name)}</span>
                </button>
                <span className="options-card__name">{name}</span>
              </li>
            )
          })}
        </ul>
      )}

      <Sheet open={open != null} title={openName} onClose={() => setOpen(null)}>
        {open && (
          <>
            {open.details && <p className="sheet__meta"><Md text={open.details} /></p>}
            {open.address && !open.details && <p className="sheet__meta">{open.address}</p>}
            {href && <a className="btn--text" href={href} target="_blank" rel="noopener noreferrer">Walk there</a>}
          </>
        )}
      </Sheet>
    </section>
  )
}
