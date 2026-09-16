import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { Md } from './Md'
import { PhotoImg } from './PhotoImg'
import { fmtTime } from '../lib/time'
import type { ItemRow } from '../lib/types'

function firstLine(s: string | null): string | null { if (!s) return null; const i = s.indexOf('\n'); return i === -1 ? s : s.slice(0, i) }

/** The Figma 1103:161 wide card: image or glyph left, name in Poppins, first details line, time. */
export function PlaceCard({ item, to, photoPath }: { item: ItemRow; to: string; photoPath?: string | null }) {
  const name = item.place_name ?? item.plan.replace(/\*\*/g, '')
  const path = photoPath ?? item.photo_path
  return (
    <Link to={to} className="place-card">
      <span className="place-card__media">
        <PhotoImg path={path} className="place-card__photo" fallback={<Icon set="kind" name="event" size={56} className="place-card__icon" />} />
      </span>
      <span className="place-card__body">
        <span className="place-card__title">{name}</span>
        {item.details && <span className="place-card__text"><Md text={firstLine(item.details)} noLinks /></span>}
        <span className="place-card__meta">{fmtTime(item.time, item.time_text)}</span>
      </span>
    </Link>
  )
}
