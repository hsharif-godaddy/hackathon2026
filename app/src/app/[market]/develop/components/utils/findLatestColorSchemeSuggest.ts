import type { CompletePalette } from '@/app/[market]/develop/components/types/colorScheme'
import type { ChatMessage, StreamingMessage } from '@/stores/useStreamingConversationStore'

export interface ColorSchemePaletteOption {
  name: string
  theme?: 'light' | 'dark'
  palette: CompletePalette
}

export interface ActiveColorSchemeSuggest {
  toolCallId: string
  messageId: string
  palettes: ColorSchemePaletteOption[]
}

function extractPalettesFromResult(result: unknown): ColorSchemePaletteOption[] | null {
  if (typeof result !== 'object' || result === null) return null
  const resultObj = result as Record<string, unknown>
  const widget = resultObj.widget as { widgetData?: { palettes?: unknown } } | undefined
  const fromRoot = resultObj.palettes
  const fromWidget = widget?.widgetData?.palettes
  const raw = (Array.isArray(fromRoot) ? fromRoot : fromWidget) as unknown[] | undefined
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: ColorSchemePaletteOption[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name : null
    const palette = row.palette as CompletePalette | undefined
    if (!name || !palette?.background || !palette?.foreground) continue
    const theme = row.theme === 'dark' || row.theme === 'light' ? row.theme : undefined
    out.push({ name, theme, palette })
  }
  return out.length > 0 ? out : null
}

export function findLatestColorSchemeSuggest(
  messages: Array<ChatMessage | StreamingMessage>
): ActiveColorSchemeSuggest | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue
    for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
      const tc = msg.toolCalls[j]
      if (tc.name !== 'colorScheme') continue
      const mode = tc.input?.mode as string | undefined
      if (mode !== 'suggest') continue
      if (tc.status !== 'completed') continue
      const palettes = extractPalettesFromResult(tc.result)
      if (!palettes?.length) continue
      return {
        toolCallId: tc.id,
        messageId: msg.id,
        palettes
      }
    }
  }
  return null
}
