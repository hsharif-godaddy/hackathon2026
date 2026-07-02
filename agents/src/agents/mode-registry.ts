/**
 * Mode Registry — maps mode IDs to metadata.
 *
 * Each registered mode must have a corresponding prompt directory at:
 *   agents/src/prompts/initial/modes/<modeId>/core.md
 */

export interface InitialAgentMode {
  id: string
  name: string
  description: string
}

export const modeRegistry: Record<string, InitialAgentMode> = {
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
  'deep-build': {
    id: 'deep-build',
    name: 'Deep Build',
    description: 'Deliberate interview → design → plan → build pipeline with sub-agent orchestration',
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
 * Get a mode by ID, or undefined if not registered.
 */
export function getMode(modeId: string): InitialAgentMode | undefined {
  return Object.hasOwn(modeRegistry, modeId) ? modeRegistry[modeId] : undefined
}

/**
 * Get all registered mode IDs.
 */
export function getModeIds(): string[] {
  return Object.keys(modeRegistry)
}
