export const LOGO_DESIGNER_TEMPLATE = 'logo-designer'
const VALID_TEMPLATES: string[] = ['default', 'business-plan', LOGO_DESIGNER_TEMPLATE]

export function validateTemplate(template: string | null): string {
  return template && VALID_TEMPLATES.includes(template) ? template : 'default'
}

export interface Example {
  title: string
  prompt: string
  slug: string
  featured?: boolean
}

export interface BuiltWithItem {
  id: string
  slug: string
  title: string
  description: string
  thumbnailPath: string
  category: string
  prompt?: string
}

export interface HeroSectionProps {
  promptText: string
  setPromptText: (text: string) => void
  onStartBuilding: () => void
  isLoading: boolean
  error: string | null
  setError: (error: string | null) => void
  onExampleClick?: (prompt: string) => void
  selectedTemplate?: string
  onTemplateChange?: (template: string) => void
  headingText?: string
  subheadingText?: string
}

export interface HeroSectionRef {
  typeText: (text: string) => void
  getFirstInputTime: () => number | null
}

export interface HeroExamplesProps {
  onExampleClick: (prompt: string) => void
  onTemplateChange?: (template: string) => void
}

export interface BuiltWithSectionProps {
  items: BuiltWithItem[]
  onExampleClick?: (prompt: string) => void
}
