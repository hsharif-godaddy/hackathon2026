import type { ChatMessage, StreamingMessage } from '@/stores/useStreamingConversationStore'

/** One vibe option, as returned by the agents `suggestDesignKits` tool result. */
export interface SuggestedDesignKitOption {
  slug: string
  displayName: string
  thumbnailUrl: string | null
  tags: string[]
  palette: {
    primary?: string
    background?: string
    foreground?: string
    accent?: string
    muted?: string
  }
  displayFont: string | null
}

export interface ActiveDesignKitSuggest {
  toolCallId: string
  messageId: string
  kits: SuggestedDesignKitOption[]
}

function extractKitsFromResult(result: unknown): SuggestedDesignKitOption[] | null {
  if (typeof result !== 'object' || result === null) return null
  const raw = (result as Record<string, unknown>).kits
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: SuggestedDesignKitOption[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const slug = typeof row.slug === 'string' ? row.slug : null
    const displayName = typeof row.displayName === 'string' ? row.displayName : null
    if (!slug || !displayName) continue
    const paletteRow = (typeof row.palette === 'object' && row.palette !== null ? row.palette : {}) as Record<string, unknown>
    const pickColor = (key: string): string | undefined =>
      typeof paletteRow[key] === 'string' ? (paletteRow[key] as string) : undefined
    out.push({
      slug,
      displayName,
      thumbnailUrl: typeof row.thumbnailUrl === 'string' ? row.thumbnailUrl : null,
      tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : [],
      palette: {
        primary: pickColor('primary'),
        background: pickColor('background'),
        foreground: pickColor('foreground'),
        accent: pickColor('accent'),
        muted: pickColor('muted'),
      },
      displayFont: typeof row.displayFont === 'string' ? row.displayFont : null,
    })
  }
  return out.length > 0 ? out : null
}

/**
 * Find the most recent completed `suggestDesignKits` tool call and return its kit
 * options — the data the design-kit vibe picker renders. Mirrors
 * {@link findLatestColorSchemeSuggest}.
 */
export function findLatestDesignKitSuggest(
  messages: Array<ChatMessage | StreamingMessage>
): ActiveDesignKitSuggest | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue
    for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
      const tc = msg.toolCalls[j]
      if (tc.name !== 'suggestDesignKits') continue
      if (tc.status !== 'completed') continue
      const kits = extractKitsFromResult(tc.result)
      if (!kits?.length) continue
      return { toolCallId: tc.id, messageId: msg.id, kits }
    }
  }
  return null
}
