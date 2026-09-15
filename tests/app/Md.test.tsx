import { render } from '@testing-library/react'
import { Md } from '../../src/components/Md'

describe('Md', () => {
  test('renders **bold** as a <strong>', () => {
    const { container } = render(<Md text="hello **world**" />)
    const strong = container.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong?.textContent).toBe('world')
  })

  test('renders a markdown link as an <a> with target and rel', () => {
    const { container } = render(<Md text="[here](https://example.com)" />)
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href')).toBe('https://example.com')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toContain('noopener')
    expect(a?.textContent).toBe('here')
  })

  test('never injects raw HTML - a script tag stays literal text', () => {
    const { container, getByText } = render(<Md text="<script>alert(1)</script>" />)
    expect(container.querySelector('script')).toBeNull()
    expect(getByText('<script>alert(1)</script>')).toBeInTheDocument()
  })

  test('renders a newline as a <br>', () => {
    const { container } = render(<Md text={'line one\nline two'} />)
    expect(container.querySelector('br')).not.toBeNull()
    expect(container.textContent).toBe('line oneline two')
  })

  test('renders nothing for null text', () => {
    const { container } = render(<Md text={null} />)
    expect(container.innerHTML).toBe('')
  })

  test('renders nothing for undefined text', () => {
    const { container } = render(<Md text={undefined} />)
    expect(container.innerHTML).toBe('')
  })

  test('renders nothing for empty string text', () => {
    const { container } = render(<Md text="" />)
    expect(container.innerHTML).toBe('')
  })

  test('applies the passed className', () => {
    const { container } = render(<Md text="hi" className="note" />)
    expect(container.querySelector('.note')).not.toBeNull()
  })

  test('does not render an <a> for an unsafe protocol - renders the literal text instead', () => {
    const { container } = render(<Md text="[x](javascript:alert(1))" />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('[x](javascript:alert(1))')
  })

  test('renders a tel: link as an <a> with that href', () => {
    const { container } = render(<Md text="[call](tel:+351123)" />)
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href')).toBe('tel:+351123')
    expect(a?.textContent).toBe('call')
  })
})
