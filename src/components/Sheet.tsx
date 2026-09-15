import { useEffect } from 'react'
import type { ReactNode } from 'react'

export function Sheet({ open, title, onClose, children }: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  if (!open) return null

  return (
    <div className="sheet-root">
      <button type="button" className="sheet-backdrop" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__header">
          <h2 className="sheet__title">{title}</h2>
          <button type="button" className="sheet__close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  )
}
