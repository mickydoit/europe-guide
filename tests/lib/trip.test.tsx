import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { loadValle } from '../helpers/content'
import { mockSupabaseContent } from '../helpers/supabaseMock'
import { TripProvider, useTrip } from '../../src/lib/trip'
import { putCachedCity, resetDbForTests } from '../../src/lib/db'

function Probe() {
  const { slug, content, offline, error, setSlug } = useTrip()
  return (
    <div>
      <div data-testid="slug">{slug ?? 'null'}</div>
      <div data-testid="items">{content ? content.items.length : 'none'}</div>
      <div data-testid="offline">{String(offline)}</div>
      <div data-testid="error">{error ?? 'none'}</div>
      <button onClick={() => setSlug('x')}>set</button>
    </div>
  )
}

beforeEach(async () => {
  await resetDbForTests()
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase('europe-guide')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
  localStorage.clear()
  history.replaceState(null, '', '/')
})

test('resolves the only trip and loads its content from a clean state', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content)
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('slug')).toHaveTextContent('valle'))
  await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent(String(content.items.length)))
  expect(screen.getByTestId('offline')).toHaveTextContent('false')
  expect(screen.getByTestId('error')).toHaveTextContent('none')
})

test('falls back to cached content and reports offline when items fails but a cache exists', async () => {
  const content = await loadValle()
  await putCachedCity(content)
  const mock = mockSupabaseContent(content, { failTable: 'items' })
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('offline')).toHaveTextContent('true'))
  expect(screen.getByTestId('items')).toHaveTextContent(String(content.items.length))
  expect(screen.getByTestId('error')).toHaveTextContent('none')
})

test('reports an error when the fetch fails and there is no cache', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content, { failTable: 'items' })
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(/items/))
  expect(screen.getByTestId('offline')).toHaveTextContent('false')
})

test('setSlug persists the choice to localStorage', async () => {
  const content = await loadValle()
  const mock = mockSupabaseContent(content)
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('slug')).toHaveTextContent('valle'))
  fireEvent.click(screen.getByRole('button', { name: 'set' }))
  expect(localStorage.getItem('europe-guide.trip')).toBe('x')
  await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(/not found/))
})

test('the ?trip= query param wins over localStorage', async () => {
  const content = await loadValle()
  localStorage.setItem('europe-guide.trip', 'other')
  history.replaceState(null, '', '/?trip=valle')
  const mock = mockSupabaseContent(content)
  render(<TripProvider client={mock.client}><Probe /></TripProvider>)
  await waitFor(() => expect(screen.getByTestId('slug')).toHaveTextContent('valle'))
})
