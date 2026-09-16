import { usePhoto } from '../lib/photos'
import { Icon } from './Icon'

/**
 * The place/event hero, shared by PlaceDetail and TicketDetail.
 *
 * It resolves the photo itself because everything else in the block turns on the answer: the
 * scrim, the white title and the credit only belong over a real photograph, and a path whose
 * bytes are not there (offline, not warmed yet, object gone) must fall all the way back to the
 * glyph on the coloured block. Hence one `usePhoto` call, not one per element.
 */
export function PlaceHero({ photoPath, credit, title, modifier }: {
  photoPath: string | null
  credit: string | null
  title: string
  modifier?: string
}) {
  const src = usePhoto(photoPath)
  return (
    <div className={`place-detail__hero${modifier ? ` ${modifier}` : ''}${src ? ' place-detail__hero--photo' : ''}`}>
      {src
        ? <img className="place-detail__photo" src={src} alt="" loading="lazy" />
        : <Icon set="kind" name="event" size={64} className="place-detail__glyph" />}
      <h1 className="place-detail__title">{title}</h1>
      {src && credit && <span className="place-detail__credit">Photo: {credit}</span>}
    </div>
  )
}
