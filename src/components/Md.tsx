import type { ReactNode } from 'react'

const TOKEN_RE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/
const LINK_RE = /^\[([^\]]+)\]\(([^)\s]+)\)$/

function renderPlainText(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) nodes.push(<br key={`${keyPrefix}-br-${i}`} />)
    if (line) nodes.push(line)
  })
  return nodes
}

export function Md({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null

  const nodes: ReactNode[] = []
  text.split(TOKEN_RE).forEach((part, i) => {
    if (!part) return
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push(<strong key={`b-${i}`}>{part.slice(2, -2)}</strong>)
      return
    }
    const link = LINK_RE.exec(part)
    if (link) {
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
