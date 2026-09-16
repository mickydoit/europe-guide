import type { ReactNode } from 'react'
import { Icon } from './Icon'

/** A section heading with its Figma glyph in front: suitcase for tickets, headphones for tours, sparkle for reminders. */
export function SectionHeading({ icon, set = 'badge', children, className }: {
  icon: string
  set?: 'nav' | 'badge'
  children: ReactNode
  className?: string
}) {
  return (
    <h2 className={`h5 section-heading${className ? ` ${className}` : ''}`}>
      <Icon set={set} name={icon} size={20} className="section-heading__icon" />
      <span>{children}</span>
    </h2>
  )
}
