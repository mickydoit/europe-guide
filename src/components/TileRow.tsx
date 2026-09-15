import type { ReactNode } from 'react'

export type TileTone = 'granny' | 'golden' | 'columbia' | 'coral' | 'salmon' | 'banana' | 'accent'

export interface Tile {
  id: string
  title: string
  tone: TileTone
  /** `solid` paints the pastel on the tile itself; `dark` keeps the card and tints the title. */
  fill: 'solid' | 'dark'
  meta?: string | null
  sub?: string | null
  /** 0–1. Renders a thin bar under the title; omit for tiles with no sense of progress. */
  progress?: number | null
  /** An external destination (opens in a new tab). Mutually exclusive with `onSelect`. */
  href?: string
  onSelect?: () => void
}

function Extras({ tile }: { tile: Tile }) {
  return (
    <>
      {tile.progress != null && (
        <span className="tile__bar">
          <span className="tile__bar-fill" style={{ width: `${Math.round(tile.progress * 100)}%` }} />
        </span>
      )}
      {tile.meta && <span className="tile__meta">{tile.meta}</span>}
      {tile.sub && <span className="tile__sub">{tile.sub}</span>}
    </>
  )
}

function TileFace({ tile, variant }: { tile: Tile; variant: 'wide' | 'square' }) {
  const className = `tile tile--${variant} tile--${tile.fill} tile--${tile.tone}`
  // Square tiles carry their captions inside the pastel face; wide ones (the Figma tour
  // tiles) keep a bare title and hang the captions underneath.
  const inner: ReactNode = (
    <>
      <span className="tile__title">{tile.title}</span>
      {variant === 'square' && <Extras tile={tile} />}
    </>
  )
  if (tile.href) {
    return <a className={className} href={tile.href} target="_blank" rel="noopener noreferrer">{inner}</a>
  }
  if (tile.onSelect) {
    return <button type="button" className={className} onClick={tile.onSelect}>{inner}</button>
  }
  return <div className={className}>{inner}</div>
}

export function TileRow({ heading, tiles, empty, variant }: {
  heading: string
  tiles: Tile[]
  empty: string
  variant: 'wide' | 'square'
}) {
  return (
    <section className="home-row">
      <h2 className="h5 home-row__heading">{heading}</h2>
      {tiles.length === 0 ? (
        <p className="caption home-row__empty">{empty}</p>
      ) : (
        <ul className={`tile-row tile-row--${variant}`}>
          {tiles.map(tile => (
            <li key={tile.id} className="tile-row__item">
              <TileFace tile={tile} variant={variant} />
              {variant === 'wide' && (
                <div className="tile-row__footer"><Extras tile={tile} /></div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
