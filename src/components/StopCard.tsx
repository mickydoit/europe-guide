import { useState } from 'react'
import { Md } from './Md'
import { fmtTime } from '../lib/time'
import { walkLink } from '../lib/links'
import type { ItemRow } from '../lib/types'

function firstLine(text: string | null): string | null {
  if (!text) return null
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

export function StopCard({ item, options, tripName, done, onToggle }: {
  item: ItemRow
  options: ItemRow[]
  tripName: string
  done: boolean
  onToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const walk = walkLink({ lat: item.lat, lng: item.lng, name: item.place_name, address: item.address }, tripName)
  const detailsFirst = firstLine(item.details)
  const hasMore = !!item.details || options.length > 0

  return (
    <div className={`stop-card${done ? ' is-done' : ''}`}>
      <div className="stop-card__row">
        <span className="stop-card__time">{fmtTime(item.time, item.time_text)}</span>
        <button
          type="button"
          className="stop-card__tick"
          aria-label={done ? 'Mark not done' : 'Mark done'}
          onClick={onToggle}
        >
          ✓
        </button>
      </div>
      <p className="stop-card__plan"><Md text={item.plan} /></p>
      {detailsFirst && <p className="stop-card__details"><Md text={detailsFirst} /></p>}
      {walk && (
        <a className="stop-card__walk" href={walk} target="_blank" rel="noopener noreferrer">Walk there</a>
      )}
      {hasMore && (
        <button
          type="button"
          className="stop-card__expand"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          Details
        </button>
      )}
      {open && (
        <div className="stop-card__panel">
          {item.details && <p className="stop-card__panel-details"><Md text={item.details} /></p>}
          {options.map(opt => {
            const optWalk = walkLink({ lat: opt.lat, lng: opt.lng, name: opt.place_name, address: opt.address }, tripName)
            return (
              <div key={opt.id} className="stop-card__option">
                <p className="stop-card__option-name"><Md text={opt.plan} /></p>
                {opt.details && <p className="stop-card__option-details"><Md text={opt.details} /></p>}
                {optWalk && (
                  <a className="stop-card__walk" href={optWalk} target="_blank" rel="noopener noreferrer">Walk there</a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
