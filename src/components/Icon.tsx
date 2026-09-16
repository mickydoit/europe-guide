/**
 * Any SVG under public/icons rendered as a CSS mask, so it takes `currentColor` and needs no
 * per-colour file. `size` is the box in px; the SVG is contained and centred inside it.
 */
export function Icon({ set, name, size = 24, className }: {
  set: 'nav' | 'kind' | 'badge'
  name: string
  size?: number
  className?: string
}) {
  const url = `url(${import.meta.env.BASE_URL}icons/${set}/${name}.svg)`
  return (
    <span
      className={`icon${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{ width: size, height: size, WebkitMaskImage: url, maskImage: url }}
    />
  )
}
