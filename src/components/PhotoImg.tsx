import type { ReactNode } from 'react'
import { usePhoto } from '../lib/photos'

/**
 * An <img> for a stored photo path. A path is not a picture: the bytes may not be cached yet,
 * the phone may be offline, the object may be gone. Whenever `usePhoto` has nothing to show,
 * the caller's `fallback` (its glyph or colour block) is rendered instead — never a broken img.
 */
export function PhotoImg({ path, className, alt = '', fallback = null }: { path: string | null | undefined; className?: string; alt?: string; fallback?: ReactNode }) {
  const src = usePhoto(path)
  if (!src) return <>{fallback}</>
  return <img className={className} src={src} alt={alt} loading="lazy" />
}
