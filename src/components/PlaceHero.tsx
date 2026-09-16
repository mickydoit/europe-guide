import { useState } from 'react'
import { usePhoto } from '../lib/photos'
import { Icon } from './Icon'
import { Md } from './Md'

/** Past this, the lede is clamped to three lines behind a Read more, the way the Figma card trails off into "....Read More". */
const CLAMP_CHARS = 140

/**
 * The place/event hero, shared by PlaceDetail and TicketDetail — the Figma 1103:161 Place Card:
 * photo (or glyph) in a media block, then a lavender panel with the uppercase title, a short
 * description and a bold meta line. Stacked on a phone, side by side once there is room.
 *
 * It resolves the photo itself because the media block turns on the answer: a path whose bytes
 * are not there (offline, not warmed yet, object gone) must fall back to the glyph and drop the
 * credit. Hence one `usePhoto` call, not one per element.
 */
export function PlaceHero({ photoPath, credit, title, description, meta, modifier }: {
  photoPath: string | null
  credit: string | null
  title: string
  description?: string | null
  meta?: string | null
  modifier?: string
}) {
  const src = usePhoto(photoPath)
  const [open, setOpen] = useState(false)
  const long = !!description && (description.length > CLAMP_CHARS || description.includes('\n'))
  return (
    <div className={`place-detail__hero${modifier ? ` ${modifier}` : ''}${src ? ' place-detail__hero--photo' : ''}`}>
      <div className="place-detail__media">
        {src
          ? <img className="place-detail__photo" src={src} alt="" loading="lazy" />
          : <Icon set="kind" name="event" size={64} className="place-detail__glyph" />}
        {src && credit && <span className="place-detail__credit">Photo: {credit}</span>}
      </div>
      <div className="place-detail__panel">
        <h1 className="place-detail__title">{title}</h1>
        {description && (
          <p className={`place-detail__lede${long && !open ? ' place-detail__lede--clamped' : ''}`}><Md text={description} /></p>
        )}
        {long && (
          <button type="button" className="place-detail__more" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? 'Read less' : 'Read more'}
          </button>
        )}
        {meta && <span className="place-detail__meta">{meta}</span>}
      </div>
    </div>
  )
}
