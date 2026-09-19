import { render } from '@testing-library/react'
import { test, expect } from 'vitest'
import { Badges } from '../../src/components/Badges'

function mask(el: Element | null): string { return (el as HTMLElement | null)?.style.maskImage ?? '' }

test('only the status badge renders — the kind is already the big glyph on the card', () => {
  const { container } = render(<Badges kind="transport" status="booked" />)
  expect(container.querySelector('.badge--kind')).toBeNull()
  expect(container.querySelectorAll('.badge')).toHaveLength(1)
  expect(container.querySelector('.badge--status')).not.toBeNull()
})

test('status badge: green check when booked or confirmed, yellow alert when still to book, grey otherwise', () => {
  const { container, rerender } = render(<Badges kind="event" status="booked" />)
  let s = container.querySelector('.badge--status')!
  expect(s.className).toContain('badge--booked'); expect(mask(s.querySelector('.icon'))).toContain('check.svg')
  rerender(<Badges kind="event" status="confirmed" />)
  expect(container.querySelector('.badge--status')!.className).toContain('badge--booked')
  rerender(<Badges kind="event" status="not_booked" />)
  s = container.querySelector('.badge--status')!
  expect(s.className).toContain('badge--todo'); expect(mask(s.querySelector('.icon'))).toContain('alert.svg')
  rerender(<Badges kind="event" status={null} />)
  expect(container.querySelector('.badge--status')!.className).toContain('badge--todo')
  rerender(<Badges kind="event" status="undecided" />)
  expect(container.querySelector('.badge--status')!.className).toContain('badge--muted')
  rerender(<Badges kind="event" status="cancelled" />)
  expect(container.querySelector('.badge--status')!.className).toContain('badge--muted')
})

test('badges carry a spoken label for the status', () => {
  const { getByLabelText } = render(<Badges kind="transport" status="booked" />)
  expect(getByLabelText('Transport, booked')).toBeInTheDocument()
})
