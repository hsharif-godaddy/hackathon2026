/**
 * API Configuration
 * 
 * Centralizes API endpoint configuration with environment variable support
 */

export interface ApiConfig {
  baseUrl: string
  wsUrl: string
  agentUrl: string
}

/**
 * Get the API configuration from environment variables with fallbacks
 */
function getApiConfig(): ApiConfig {
  // Default to localhost for development
  const defaultBaseUrl = 'http://localhost:4000'
  const defaultWsUrl = 'ws://localhost:4000'
  
  // Environment variables for configuration
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || defaultBaseUrl
  const wsUrl = process.env.NEXT_PUBLIC_API_WS_URL || defaultWsUrl
  
  // Ensure URLs don't have trailing slashes
  const cleanBaseUrl = baseUrl.replace(/\/$/, '')
  const cleanWsUrl = wsUrl.replace(/\/$/, '')
  
  return {
    baseUrl: cleanBaseUrl,
    wsUrl: cleanWsUrl,
    agentUrl: cleanBaseUrl // Agent endpoints use the same base URL
  }
}

// Export singleton configuration
export const apiConfig = getApiConfig()

/**
 * Helper function to build API URLs
 */
export function buildApiUrl(endpoint: string): string {
  // Remove leading slash if present to avoid double slashes
  const cleanEndpoint = endpoint.replace(/^\//, '')
  return `${apiConfig.baseUrl}/${cleanEndpoint}`
}

/**
 * Helper function to build WebSocket URLs
 */
export function buildWsUrl(endpoint: string): string {
  // Remove leading slash if present to avoid double slashes
  const cleanEndpoint = endpoint.replace(/^\//, '')
  return `${apiConfig.wsUrl}/${cleanEndpoint}`
}

/**
 * Helper function to build agent URLs
 */
export function buildAgentUrl(endpoint: string): string {
  // Remove leading slash if present to avoid double slashes
  const cleanEndpoint = endpoint.replace(/^\//, '')
  return `${apiConfig.agentUrl}/${cleanEndpoint}`
}

/**
 * Validate that the API configuration is valid
 */
export function validateApiConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = []
  
  if (!apiConfig.baseUrl) {
    errors.push('Base URL is required')
  }
  
  if (!apiConfig.wsUrl) {
    errors.push('WebSocket URL is required')
  }
  
  try {
    new URL(apiConfig.baseUrl)
  } catch {
    errors.push('Base URL is not a valid URL')
  }
  
  try {
    new URL(apiConfig.wsUrl.replace('ws://', 'http://').replace('wss://', 'https://'))
  } catch {
    errors.push('WebSocket URL is not a valid URL')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

// Log configuration in development
if (process.env.NODE_ENV === 'development') {
  console.log('🔧 API Configuration:', {
    baseUrl: apiConfig.baseUrl,
    wsUrl: apiConfig.wsUrl,
    agentUrl: apiConfig.agentUrl
  })
  
  const validation = validateApiConfig()
  if (!validation.isValid) {
    console.warn('⚠️  API Configuration issues:', validation.errors)
  }
}
