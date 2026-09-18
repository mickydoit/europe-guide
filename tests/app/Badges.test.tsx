import { render } from '@testing-library/react'
import { test, expect } from 'vitest'
import { Badges } from '../../src/components/Badges'

function mask(el: Element | null): string { return (el as HTMLElement | null)?.style.maskImage ?? '' }

test('kind badge picks the plane/car/train/hotel/event/meal glyph from the badge set', () => {
  const { container, rerender } = render(<Badges kind="transport" title="Ryanair FR3628 LIS → SVQ" status="booked" />)
  expect(mask(container.querySelector('.badge--kind .icon'))).toContain('/icons/badge/plane.svg')
  rerender(<Badges kind="transport" title="Taxi to Benfica" status="booked" />)
  expect(mask(container.querySelector('.badge--kind .icon'))).toContain('/icons/badge/car.svg')
  rerender(<Badges kind="accommodation" title="Hotel" status="booked" />)
  expect(mask(container.querySelector('.badge--kind .icon'))).toContain('/icons/badge/hotel.svg')
  rerender(<Badges kind="transport" title="AVE Seville → Barcelona" status="booked" />)
  expect(mask(container.querySelector('.badge--kind .icon'))).toContain('/icons/badge/train.svg')
  rerender(<Badges kind="event" title="Dinner" status="booked" />)
  expect(mask(container.querySelector('.badge--kind .icon'))).toContain('/icons/badge/meal.svg')
  rerender(<Badges kind="event" title="Mesa de Frades — fado show" status="booked" />)
  expect(mask(container.querySelector('.badge--kind .icon'))).toContain('/icons/badge/event.svg')
})

test('status badge: green check when booked or confirmed, yellow alert when still to book, grey otherwise', () => {
  const { container, rerender } = render(<Badges kind="event" title="x" status="booked" />)
  let s = container.querySelector('.badge--status')!
  expect(s.className).toContain('badge--booked'); expect(mask(s.querySelector('.icon'))).toContain('check.svg')
  rerender(<Badges kind="event" title="x" status="confirmed" />)
  expect(container.querySelector('.badge--status')!.className).toContain('badge--booked')
  rerender(<Badges kind="event" title="x" status="not_booked" />)
  s = container.querySelector('.badge--status')!
  expect(s.className).toContain('badge--todo'); expect(mask(s.querySelector('.icon'))).toContain('alert.svg')
  rerender(<Badges kind="event" title="x" status={null} />)
  expect(container.querySelector('.badge--status')!.className).toContain('badge--todo')
  rerender(<Badges kind="event" title="x" status="undecided" />)
  expect(container.querySelector('.badge--status')!.className).toContain('badge--muted')
  rerender(<Badges kind="event" title="x" status="cancelled" />)
  expect(container.querySelector('.badge--status')!.className).toContain('badge--muted')
})

test('badges carry a spoken label for the status', () => {
  const { getByLabelText } = render(<Badges kind="transport" title="Train" status="booked" />)
  expect(getByLabelText('Transport, booked')).toBeInTheDocument()
})
