import type { ChatMessage, StreamingMessage } from '@/stores/useStreamingConversationStore'
import type { FontThemeSuggestOption } from './findLatestFontThemeSuggest'

function extractFontFromApply(result: unknown): FontThemeSuggestOption | null {
  if (typeof result !== 'object' || result === null) return null
  const resultObj = result as Record<string, unknown>

  const themeName = (resultObj.themeName as string | undefined) || 'Current'
  const headerFontName = resultObj.headerFont as string | undefined
  const bodyFontName = resultObj.bodyFont as string | undefined

  // Try to extract full font objects if available
  const appliedFont = resultObj.appliedFont as {
    name?: string
    headerFont?: { name: string; weights: string[]; category?: string }
    bodyFont?: { name: string; weights: string[]; category?: string }
  } | undefined

  let headerFont: FontThemeSuggestOption['headerFont'] | undefined
  let bodyFont: FontThemeSuggestOption['bodyFont'] | undefined

  if (appliedFont?.headerFont && appliedFont?.bodyFont) {
    headerFont = {
      name: appliedFont.headerFont.name,
      weights: appliedFont.headerFont.weights || ['400', '700'],
      category: appliedFont.headerFont.category
    }
    bodyFont = {
      name: appliedFont.bodyFont.name,
      weights: appliedFont.bodyFont.weights || ['400', '500'],
      category: appliedFont.bodyFont.category
    }
  } else if (headerFontName && bodyFontName) {
    // Fallback: use font names from result (no weight/category info)
    headerFont = {
      name: headerFontName,
      weights: ['400', '700']
    }
    bodyFont = {
      name: bodyFontName,
      weights: ['400', '500']
    }
  }

  if (!headerFont || !bodyFont) return null

  return {
    id: 'current-applied',
    name: themeName,
    headerFont,
    bodyFont
  }
}

export function findLatestAppliedFontTheme(
  messages: Array<ChatMessage | StreamingMessage>
): FontThemeSuggestOption | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue
    for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
      const tc = msg.toolCalls[j]
      if (tc.name !== 'fontTheme') continue
      const mode = tc.input?.mode as string | undefined
      if (mode !== 'apply') continue
      if (tc.status !== 'completed') continue
      const font = extractFontFromApply(tc.result)
      if (!font) continue
      return font
    }
  }
  return null
}
