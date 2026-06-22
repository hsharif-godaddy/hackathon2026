import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

const BASE_SUGGESTIONS = [
  { text: 'Edit or refine this logo' },
  { text: 'Try a different logo style' },
  { text: 'Build a website with this logo', trackingId: 'logo_designer_build_website' },
]

const SET_AS_LOGO_SUGGESTION = { text: 'Set as my logo' }

export const logoCompletionSuggestionsAITool: Tool = createTool(
  'Get the available completion suggestions to show the user after logo generation is complete. Call this to determine which options to present in askQuestion. Pass excludeSetAsLogo: true immediately after the user has already set their logo (to avoid showing the option again until the logo changes).',
  z.object({
    excludeSetAsLogo: z.boolean().optional().describe('Set to true if the user just completed "Set as my logo" and the logo has not changed since'),
  }),
  async (input, context) => {
    const isEmbedded = context?.metadata?.isEmbedded === true
    const includeSetAsLogo = isEmbedded && !input.excludeSetAsLogo
    const suggestions = includeSetAsLogo
      ? [...BASE_SUGGESTIONS, SET_AS_LOGO_SUGGESTION]
      : BASE_SUGGESTIONS

    return {
      success: true,
      suggestions,
    }
  }
)
