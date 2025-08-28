/**
 * V7-specific configuration for dev-tools
 * 
 * This file contains v7-specific overrides and configurations
 * that differ from the base v3 dev-tools implementation.
 */

export const V7_CONFIG = {
  // v7 uses a different project structure - frontend only with main.tsx
  importPath: '../dev-tools/src/index',
  
  // v7 entry points for plugin injection
  entryPoints: ['src/main.tsx', 'src/index.tsx'],
  
  // v7 doesn't have entry-client.tsx like v3
  hasEntryClient: false,
  
  // v7-specific file structure
  structure: 'frontend-only'
} as const

export type V7Config = typeof V7_CONFIG