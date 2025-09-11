/**
 * Centralized feature configuration system
 * This module handles all environment variable parsing and feature flags
 */

interface FeatureConfig {
  showCodeEditor: boolean
  useMockLogin: boolean
  developmentMode: boolean
  showGalleryPage: boolean
  // Add more features here as needed
}

/**
 * Parse environment variables and return feature configuration
 */
function parseEnvironmentFeatures(): FeatureConfig {
  return {
    showCodeEditor: process.env.NEXT_PUBLIC_SHOW_CODE_EDITOR === 'true',
    useMockLogin: process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_USE_MOCK_LOGIN === 'true',
    developmentMode: process.env.NODE_ENV === 'development',
    showGalleryPage: process.env.NEXT_PUBLIC_SHOW_GALLERY_PAGE === 'true',
    // Add more feature parsing here
  }
}

/**
 * Get the current feature configuration
 * This is the main export that components should use
 */
export const features = parseEnvironmentFeatures()

/**
 * Feature flag checker functions for better type safety and readability
 */
export const isFeatureEnabled = {
  codeEditor: () => features.showCodeEditor,
  mockLogin: () => features.useMockLogin,
  developmentMode: () => features.developmentMode,
  galleryPage: () => features.showGalleryPage,
  // Add more feature checkers here
} as const

/**
 * Debug function to log all current feature states
 * Useful for development and troubleshooting
 */
export function logFeatureState(): void {
  if (process.env.NODE_ENV === 'development') {
    console.log('Feature flags:', features)
  }
}