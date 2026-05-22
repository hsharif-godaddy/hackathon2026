import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { fetchDesignSystemCatalog } from '../../services/design-system/catalog.js'
import { logger } from '../../logging/index.js'

export const listDesignSystemsAITool: Tool = createTool(
  'List available design systems from the catalog. Each entry shows slug, whenToUse, and tags. Use the slugs verbatim when calling installDesignSystem.',
  z.object({
    tags: z.array(z.string()).optional().describe('Optional. Restrict to design systems whose tags include any of these values.'),
  }),
  async (input) => {
    try {
      const catalog = await fetchDesignSystemCatalog()
      const filterTags = input.tags?.map((t: string) => t.toLowerCase()) ?? []
      const matches = filterTags.length === 0
        ? catalog.kits
        : catalog.kits.filter((k: { tags: string[] }) => k.tags.some((t: string) => filterTags.includes(t.toLowerCase())))

      if (matches.length === 0) return 'No design systems matched the requested tags.'

      const lines: string[] = ['# Design System Catalog', '']
      for (const kit of matches) {
        lines.push(`## ${kit.slug}`)
        lines.push('')
        lines.push(kit.whenToUse)
        lines.push('')
        lines.push(`Tags: ${kit.tags.join(', ')}`)
        lines.push('')
      }
      return lines.join('\n')
    } catch (err) {
      logger.warn('tool.list_design_systems.failed', { err: String(err) })
      return 'Design system catalog is currently unavailable.'
    }
  }
)
