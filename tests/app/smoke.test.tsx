import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../../src/App'
test('renders the Home placeholder and five tabs', () => {
  render(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
  expect(screen.getAllByRole('link')).toHaveLength(5)
})
