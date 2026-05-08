function stripPrefix(value: string): string {
  return value.replace(/^\s*\[(high|medium|low)\]\s*/i, '').trim()
}

export function parseInsightValue(value: string): { title: string; description: string } {
  const trimmed = value.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>
        const title = typeof record.title === 'string' ? record.title.trim() : ''
        const detail = typeof record.detail === 'string' ? record.detail.trim() : ''
        if (title || detail) return { title, description: detail }
      }
    } catch {
      // ignore
    }
  }

  const cleaned = stripPrefix(value)
  
  const dashMatch = cleaned.match(/^(.+?)\s*[—\-–]\s+([\s\S]*)$/)
  if (dashMatch) {
    return { title: dashMatch[1].trim(), description: dashMatch[2].trim() }
  }

  // If no dash is present, treat the entire text as a description
  return { title: '', description: cleaned }
}
