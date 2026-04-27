import type { CompletePalette } from '@/app/[market]/develop/components/types/colorScheme'
import type { ChatMessage, StreamingMessage } from '@/stores/useStreamingConversationStore'
import type { ColorSchemePaletteOption } from './findLatestColorSchemeSuggest'

function extractPaletteFromApply(result: unknown): ColorSchemePaletteOption | null {
  if (typeof result !== 'object' || result === null) return null
  const resultObj = result as Record<string, unknown>
  const palette = resultObj.palette as CompletePalette | undefined
  const paletteName = (resultObj.paletteName as string | undefined) || 'Current Theme'

  if (!palette?.background || !palette?.foreground) return null

  const theme = (palette as unknown as { theme?: 'light' | 'dark' })?.theme

  return {
    name: paletteName,
    theme,
    palette
  }
}

export function findLatestAppliedColorScheme(
  messages: Array<ChatMessage | StreamingMessage>
): ColorSchemePaletteOption | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue
    for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
      const tc = msg.toolCalls[j]
      if (tc.name !== 'colorScheme') continue
      const mode = tc.input?.mode as string | undefined
      if (mode !== 'apply') continue
      if (tc.status !== 'completed') continue
      const palette = extractPaletteFromApply(tc.result)
      if (!palette) continue
      return palette
    }
  }
  return null
}
