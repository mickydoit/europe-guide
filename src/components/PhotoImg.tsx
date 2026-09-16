import { usePhoto } from '../lib/photos'

/** An <img> for a stored photo path, or nothing while it is unknown or missing so the parent's fallback shows through. */
export function PhotoImg({ path, className, alt = '' }: { path: string | null | undefined; className?: string; alt?: string }) {
  const src = usePhoto(path)
  if (!src) return null
  return <img className={className} src={src} alt={alt} loading="lazy" />
}
