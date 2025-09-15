export interface Example {
  title: string
  prompt: string
}

export interface BuiltWithItem {
  id: string
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
  onShowMockLogin?: () => void
}

export interface HeroSectionRef {
  typeText: (text: string) => void
}

export interface ExamplesSectionProps {
  examples: Example[]
  onExampleClick: (prompt: string) => void
}

export interface BuiltWithSectionProps {
  items: BuiltWithItem[]
  onExampleClick?: (prompt: string) => void
}
