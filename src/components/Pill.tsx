import type { ReactNode } from 'react'

export type PillTone = 'accent' | 'salmon' | 'banana' | 'columbia' | 'muted' | 'coral'

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>
}
