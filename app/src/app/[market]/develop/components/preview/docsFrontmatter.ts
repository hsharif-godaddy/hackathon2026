const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/

export interface FrontmatterEntry {
  key: string
  value: string
}

export interface ParsedFrontmatter {
  entries: FrontmatterEntry[]
  body: string
}

export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match: RegExpMatchArray | null = content.match(FRONTMATTER_RE)
  if (!match) return null
  const raw: string = match[1]!
  const entries: FrontmatterEntry[] = []
  for (const line of raw.split('\n')) {
    const colonIdx: number = line.indexOf(':')
    if (colonIdx > 0) {
      entries.push({ key: line.slice(0, colonIdx).trim(), value: line.slice(colonIdx + 1).trim() })
    }
  }
  return { entries, body: content.slice(match[0].length) }
}

export function extractFrontmatter(content: string): { frontmatter: string; body: string } {
  const match: RegExpMatchArray | null = content.match(FRONTMATTER_RE)
  if (!match) return { frontmatter: '', body: content }
  return { frontmatter: match[0], body: content.slice(match[0].length) }
}
