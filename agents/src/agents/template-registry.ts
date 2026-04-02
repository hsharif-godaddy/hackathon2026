/**
 * Template Registry — maps template IDs to metadata.
 *
 * Each registered template must have a corresponding prompt directory at:
 *   agents/src/prompts/initial/templates/<templateId>/core.md
 */

export interface InitialAgentTemplate {
  id: string
  name: string
  description: string
}

export const templateRegistry: Record<string, InitialAgentTemplate> = {
  'business-plan': {
    id: 'business-plan',
    name: 'Business Plan Website',
    description: 'Guides the user through creating a business plan website',
  },
  'logo-designer': {
    id: 'logo-designer',
    name: 'Logo Designer',
    description: 'Discovers brand identity and creates a logo showcase website',
  },
}

/**
 * Get a template by ID, or undefined if not registered.
 */
export function getTemplate(templateId: string): InitialAgentTemplate | undefined {
  return Object.hasOwn(templateRegistry, templateId) ? templateRegistry[templateId] : undefined
}

/**
 * Get all registered template IDs.
 */
export function getTemplateIds(): string[] {
  return Object.keys(templateRegistry)
}
