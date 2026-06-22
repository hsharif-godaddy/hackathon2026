/**
 * Type declarations for modules that ship without type definitions.
 * These are runtime deps loaded via CDS or as untyped packages.
 */

declare module '@airo-ux/pattern-library/primitives/thinking-indicator' {
  import type { ComponentType } from 'react'
  interface ThinkingIndicatorProps {
    variant?: 'spinner' | 'godaddy' | 'dots' | 'thinking-daddy'
    size?: number
    'data-testid'?: string
  }
  export const ThinkingIndicator: ComponentType<ThinkingIndicatorProps>
}

declare module 'react-router-dom' {
  import type { ComponentType, ReactNode } from 'react'
  export const MemoryRouter: ComponentType<{ children?: ReactNode; basename?: string; initialEntries?: string[] }>
  export const Routes: ComponentType<{ children?: ReactNode }>
  export const Route: ComponentType<Record<string, unknown>>
}
