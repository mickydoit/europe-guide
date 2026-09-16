import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi, beforeEach } from 'vitest'
import { PlaceCard } from '../../src/components/PlaceCard'
import type { ItemRow } from '../../src/lib/types'

const { usePhotoMock } = vi.hoisted(() => ({ usePhotoMock: vi.fn((p: string | null) => (p ? `blob:${p}` : null)) }))
vi.mock('../../src/lib/photos', () => ({ usePhoto: usePhotoMock, warmTripPhotos: vi.fn() }))

const item: ItemRow = {
  id: 'valle/2026-11-02/0830/piazza-grande', trip: 'valle', date: '2026-11-02', block: 'morning', time: '08:30', time_text: null,
  approx: false, kind: 'stop', parent_item: null, plan: '**Piazza Grande**', details: 'Coffee and market stalls', sort: 0,
  place_name: 'Piazza Grande', address: null, lat: 45.1, lng: 7.2, url: null, route_id: null,
  photo_path: null, photo_credit: null,
}
const mount = (i: ItemRow) => render(<MemoryRouter><PlaceCard item={i} to="/place/x" /></MemoryRouter>)

beforeEach(() => { usePhotoMock.mockImplementation((p: string | null) => (p ? `blob:${p}` : null)) })

test('a photo_path with bytes fills the media slot', () => {
  mount({ ...item, photo_path: 'valle/x.jpg' })
  expect(screen.getByRole('link').querySelector('.place-card__photo')).toHaveAttribute('src', 'blob:valle/x.jpg')
  expect(screen.getByRole('link').querySelector('.place-card__icon')).toBeNull()
})

test('a photo_path whose bytes are not available falls back to the glyph', () => {
  usePhotoMock.mockReturnValue(null)
  mount({ ...item, photo_path: 'valle/x.jpg' })
  expect(screen.getByRole('link').querySelector('.place-card__icon')).not.toBeNull()
  expect(screen.getByRole('link').querySelector('img')).toBeNull()
})

test('no photo_path at all shows the glyph', () => {
  mount(item)
  expect(screen.getByRole('link').querySelector('.place-card__icon')).not.toBeNull()
})
