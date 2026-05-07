import type { ChatMessage, StreamingMessage } from '@/stores/useStreamingConversationStore'

export interface FontThemeSuggestFont {
  category?: string
  name: string
  weights: string[]
}

export interface FontThemeSuggestOption {
  bodyFont: FontThemeSuggestFont
  description?: string
  headerFont: FontThemeSuggestFont
  id: string
  name: string
}

export interface ActiveFontThemeSuggest {
  messageId: string
  themes: FontThemeSuggestOption[]
  toolCallId: string
}

function normalizeFont(row: Record<string, unknown>): FontThemeSuggestFont | null {
  const name = typeof row.name === 'string' ? row.name : null
  const weightsRaw = row.weights
  const weights = Array.isArray(weightsRaw)
    ? weightsRaw.filter((w): w is string => typeof w === 'string')
    : typeof weightsRaw === 'undefined' || weightsRaw === null
      ? ['400', '700']
      : []
  if (!name) return null
  const category = typeof row.category === 'string' ? row.category : undefined
  return { category, name, weights: weights.length > 0 ? weights : ['400', '700'] }
}

function extractThemesFromResult(result: unknown): FontThemeSuggestOption[] | null {
  if (typeof result !== 'object' || result === null) return null
  const resultObj = result as Record<string, unknown>
  const widget = resultObj.widget as { widgetData?: { themes?: unknown } } | undefined
  const fromRoot = resultObj.themes
  const fromWidget = widget?.widgetData?.themes
  const raw = (Array.isArray(fromRoot) ? fromRoot : fromWidget) as unknown[] | undefined
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: FontThemeSuggestOption[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : null
    const name = typeof row.name === 'string' ? row.name : null
    if (!id || !name) continue
    let headerFont = row.headerFont ? normalizeFont(row.headerFont as Record<string, unknown>) : null
    let bodyFont = row.bodyFont ? normalizeFont(row.bodyFont as Record<string, unknown>) : null
    const legacy = row.font ? normalizeFont(row.font as Record<string, unknown>) : null
    if (!headerFont && legacy) headerFont = legacy
    if (!bodyFont && legacy) bodyFont = legacy
    if (!headerFont || !bodyFont) continue
    const description = typeof row.description === 'string' ? row.description : undefined
    out.push({ bodyFont, description, headerFont, id, name })
  }
  return out.length > 0 ? out : null
}

export function findLatestFontThemeSuggest(
  messages: Array<ChatMessage | StreamingMessage>
): ActiveFontThemeSuggest | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue
    for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
      const tc = msg.toolCalls[j]
      if (tc.name !== 'fontTheme') continue
      const mode = tc.input?.mode as string | undefined
      if (mode !== 'suggest') continue
      if (tc.status !== 'completed') continue
      const themes = extractThemesFromResult(tc.result)
      if (!themes?.length) continue
      return {
        messageId: msg.id,
        themes,
        toolCallId: tc.id,
      }
    }
  }
  return null
}
