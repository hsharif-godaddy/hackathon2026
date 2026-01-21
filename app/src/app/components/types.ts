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
}

export interface HeroSectionRef {
  typeText: (text: string) => void
}

export interface HeroExamplesProps {
  onExampleClick: (prompt: string) => void
}

export interface BuiltWithSectionProps {
  items: BuiltWithItem[]
  onExampleClick?: (prompt: string) => void
}
