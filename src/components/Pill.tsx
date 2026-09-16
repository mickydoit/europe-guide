import type { ReactNode } from 'react'

export type PillTone = 'accent' | 'highlight' | 'lavender' | 'muted'

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>
}
