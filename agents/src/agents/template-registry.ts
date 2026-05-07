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
  'design-spec': {
    id: 'design-spec',
    name: 'Design Spec Builder',
    description: 'Builds directly from a design.md specification, skipping design questioning',
  },
  'zip-import': {
    id: 'zip-import',
    name: 'ZIP Import',
    description: 'Writes uploaded ZIP file contents (styles, pages, components) directly to the app',
  },
  'ui-kit-import': {
    id: 'ui-kit-import',
    name: 'UI Kit Import',
    description: 'Imports a UI kit design system and applies CSS tokens, fonts, and design patterns',
  },
  'file-upload': {
    id: 'file-upload',
    name: 'File Upload',
    description: 'Adapts the initial agent flow based on uploaded file classification (images, text docs, specs)',
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
