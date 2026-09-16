import type { ReactNode } from 'react'

const TOKEN_RE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/
const LINK_RE = /^\[([^\]]+)\]\(([^)\s]+)\)$/
const SAFE_PROTOCOL_RE = /^(?:https?:|mailto:|tel:)/i

function renderPlainText(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) nodes.push(<br key={`${keyPrefix}-br-${i}`} />)
    if (line) nodes.push(line)
  })
  return nodes
}

export function Md({ text, className, noLinks }: { text: string | null | undefined; className?: string; noLinks?: boolean }) {
  if (!text) return null

  const nodes: ReactNode[] = []
  text.split(TOKEN_RE).forEach((part, i) => {
    if (!part) return
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push(<strong key={`b-${i}`}>{part.slice(2, -2)}</strong>)
      return
    }
    const link = LINK_RE.exec(part)
    if (link && SAFE_PROTOCOL_RE.test(link[2])) {
      // noLinks: a link nested inside another <a> (e.g. a StopRow/PlaceCard tap target) is
      // invalid HTML and breaks the outer link's accessible name — render just the label.
      if (noLinks) {
        nodes.push(...renderPlainText(link[1], `t-${i}`))
        return
      }
      nodes.push(
        <a key={`a-${i}`} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>,
      )
      return
    }
    nodes.push(...renderPlainText(part, `t-${i}`))
  })

  return <span className={className}>{nodes}</span>
}
