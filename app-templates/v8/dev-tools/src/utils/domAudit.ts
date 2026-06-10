export interface AuditIssue {
  type: 'broken-image' | 'broken-link' | 'empty-section' | 'placeholder-text'
  detail: string
  src?: string
  href?: string
}

export function runDomAudit(validRoutes: string[]): AuditIssue[] {
  const issues: AuditIssue[] = []

  // Broken images (loaded but 0 naturalWidth or errored)
  document.querySelectorAll('img[src]').forEach(img => {
    const el = img as HTMLImageElement
    if (el.complete && el.naturalWidth === 0 && el.src && !el.src.startsWith('data:')) {
      issues.push({
        type: 'broken-image',
        src: el.src,
        detail: `Image failed to load: ${el.src}`,
      })
    }
  })

  // Broken internal links (href to routes that don't exist)
  const routeSet = new Set(validRoutes)
  document.querySelectorAll('a[href^="/"]').forEach(a => {
    const el = a as HTMLAnchorElement
    try {
      const pathname = new URL(el.href).pathname
      if (pathname !== '#' && pathname !== '/' && !routeSet.has(pathname)) {
        issues.push({
          type: 'broken-link',
          href: pathname,
          detail: `Link to nonexistent route: ${pathname} ("${(el.textContent ?? '').trim().slice(0, 40)}")`,
        })
      }
    } catch {
      // Invalid URL, skip
    }
  })

  // Empty sections (no text and no media)
  document.querySelectorAll('section, [role="region"], main > div').forEach(el => {
    const htmlEl = el as HTMLElement
    const text = htmlEl.innerText?.trim() ?? ''
    const hasMedia = el.querySelector('img, svg, video, canvas, iframe')
    if (text.length < 10 && !hasMedia) {
      issues.push({
        type: 'empty-section',
        detail: `Empty section: <${el.tagName.toLowerCase()}> with no visible content`,
      })
    }
  })

  // Placeholder text patterns
  const bodyText = document.body.innerText ?? ''
  const patterns: Array<[RegExp, string]> = [
    [/lorem ipsum/i, 'Lorem ipsum placeholder text'],
    [/\bTODO\b/, 'TODO marker in visible content'],
    [/placeholder/i, '"placeholder" text visible on page'],
    [/example\.com/i, 'example.com URL in visible content'],
    [/your\s+\w+\s+here/i, '"your X here" placeholder'],
  ]

  for (const [pattern, label] of patterns) {
    const match = bodyText.match(pattern)
    if (match) {
      issues.push({
        type: 'placeholder-text',
        detail: `${label}: "${match[0]}"`,
      })
    }
  }

  return issues
}
