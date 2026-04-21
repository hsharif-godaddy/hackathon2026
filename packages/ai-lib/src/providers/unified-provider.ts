/**
 * Unified Provider Helper
 *
 * Single provider function that handles both OpenAI and Anthropic with short names,
 * automatic environment variable validation, and proxy support.
 */

import { createLogger, containsBudgetExceededPattern, llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { wrapLanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { Agent } from 'undici'

// Extend undici timeouts for LLM streaming — long generations can pause for
// minutes between chunks (e.g. extended thinking). The default 300s undici
// bodyTimeout/headersTimeout can fire before the AI SDK's application-layer
// timeout, causing UND_ERR_BODY_TIMEOUT or UND_ERR_HEADERS_TIMEOUT mid-stream.
// The AI SDK's own timeout config (stepMs, chunkMs) handles application-level
// timeouts at a higher layer, so we raise the undici timeouts to 10 minutes.
const llmDispatcher = new Agent({ bodyTimeout: 600_000, headersTimeout: 600_000 })

function llmFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, dispatcher: llmDispatcher } as RequestInit)
}

export function destroyLlmDispatcher(): Promise<void> {
  return llmDispatcher.destroy()
}

const logger = createLogger('unified-provider')
import {
  normalizeModelName,
  getLegacyModelMappings,
  getAvailableModels as getAvailableModelsFromNormalization,
  isModelSupported as isModelSupportedFromNormalization,
  getFullModelName as getFullModelNameFromNormalization
} from '../utils/model-normalization.js'
import { createCostTrackingMiddleware } from './usage-instrumentation-middleware.js'
import { getS2SProviderConfig, isS2SAuthEnabled, getDefaultAnthropicProxyEndpoint, refreshS2SToken, getS2SToken, type S2SAuthConfig } from '../utils/s2s-auth.js'
import { grantSessionManager } from '@airo/ai-grants'

/**
 * Claude models that can be routed through OpenAI proxy
 * Maps short names to their OpenAI proxy model identifiers
 */
const CLAUDE_PROXY_MODELS = {
  'claude-opus-4-6': 'claude-opus-4-6',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'azure/claude-sonnet-4-6': 'azure/claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'sonnet': 'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  'haiku': 'claude-haiku-4-5-20251001',
} as const

// Use unified model mappings from model-normalization
const MODEL_MAPPINGS = getLegacyModelMappings()
type ModelShortName = keyof typeof MODEL_MAPPINGS

/**
 * Provider configuration options
 */
export interface ProviderConfig {
  /** OpenAI API key override */
  openaiApiKey?: string
  /** OpenAI base URL override (for proxy) */
  openaiBaseUrl?: string
  /** Anthropic API key override */
  anthropicApiKey?: string
  /** Anthropic base URL override (for proxy) */
  anthropicBaseUrl?: string
  /** S2S authentication configuration */
  s2sAuth?: S2SAuthConfig
  /**
   * List of anthropic-beta header values to block for proxy compatibility.
   * If not specified or empty, all beta headers pass through.
   * Example: ['max-tokens-3-5-sonnet-2022-07-15']
   */
  blockedAnthropicBetaHeaders?: string[]
}

// Default anthropic-beta headers to block for compatibility with downstream proxies
const DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS: string[] = ['structured-outputs-2025-11-13']

/**
 * Validate OpenAI configuration
 * Skips API key validation when S2S authentication is enabled
 */
function validateOpenAIConfig(config?: ProviderConfig): void {
  // Skip API key validation if S2S authentication is enabled
  if (isS2SAuthEnabled()) {
    return;
  }

  const apiKey = config?.openaiApiKey || process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass openaiApiKey in config.')
  }
}

/**
 * Check if Anthropic credentials are available
 */
function hasAnthropicCredentials(config?: ProviderConfig): boolean {
  return !!(config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY)
}

/**
 * Check if a Claude model should be routed through a proxy
 * Returns the proxy type to use: 'openai' | 'anthropic' | null
 */
function getClaudeProxyType(modelName: string, config?: ProviderConfig): 'openai' | 'anthropic' | null {
  // Check if model is in our Claude proxy list
  const isClaudeProxyModel = modelName in CLAUDE_PROXY_MODELS
  if (!isClaudeProxyModel) {
    return null
  }

  // If S2S auth is enabled, prefer Anthropic proxy (since we have GoCode endpoints)
  if (isS2SAuthEnabled()) {
    return 'anthropic'
  }

  // Check available proxy options
  const hasAnthropicCreds = hasAnthropicCredentials(config)
  const hasOpenAIProxy = !!(config?.openaiBaseUrl || process.env.OPENAI_BASE_URL)

  // Prefer Anthropic direct access if available
  if (hasAnthropicCreds) {
    return 'anthropic'
  }

  // Fall back to OpenAI proxy if available
  if (hasOpenAIProxy) {
    return 'openai'
  }

  return null
}

/**
 * Check if a Claude model should be routed through OpenAI proxy (backward compatibility)
 */
function shouldUseClaudeProxy(modelName: string, config?: ProviderConfig): boolean {
  return getClaudeProxyType(modelName, config) === 'openai'
}

/**
 * Determine provider type from model name, considering proxy routing
 */
function getProviderType(modelName: string, config?: ProviderConfig): 'openai' | 'anthropic' {
  // Check if this Claude model should be routed through a proxy
  const proxyType = getClaudeProxyType(modelName, config)
  if (proxyType) {
    return proxyType
  }

  // Use unified model normalization to determine provider
  const modelInfo = normalizeModelName(modelName)

  // Map unified provider types to legacy types
  switch (modelInfo.provider) {
    case 'anthropic':
      return 'anthropic'
    case 'openai':
    default:
      return 'openai'
  }
}

/**
 * Create raw OpenAI client for direct usage (e.g., image generation)
 * Uses the same authentication logic as the unified provider
 * Includes automatic token refresh on authentication failures via custom fetch
 */
export async function createOpenAIClient(config?: ProviderConfig): Promise<any> {
  // Check if S2S authentication is enabled and get config
  const s2sConfig = await getS2SProviderConfig(config?.s2sAuth)

  if (s2sConfig) {
    // Use S2S authentication with GoCode endpoint
    const { default: OpenAI } = await import('openai')
    return new OpenAI({
      apiKey: s2sConfig.apiKey, // Placeholder API key
      baseURL: s2sConfig.baseURL.endsWith('/v1') ? s2sConfig.baseURL : s2sConfig.baseURL + '/v1', // Ensure /v1 suffix
      fetch: createS2SFetchWrapper(config?.s2sAuth) // Custom fetch with token injection and refresh
    })
  } else {
    // Use regular OpenAI authentication
    const fallbackApiKey = config?.openaiApiKey || process.env.ANTHROPIC_API_KEY || ''

    if (!fallbackApiKey) {
      throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass anthropicApiKey in config.')
    }

    const { default: OpenAI } = await import('openai')
    const openaiConfig: any = {
      apiKey: fallbackApiKey,
      fetch: llmFetch
    }

    // Add base URL if provided (for proxy support)
    const baseURL = config?.openaiBaseUrl || process.env.ANTHROPIC_BASE_URL
    if (baseURL) {
      // Ensure URL ends with /v1 for OpenAI API compatibility
      openaiConfig.baseURL = baseURL.endsWith('/v1') ? baseURL : baseURL + '/v1'
    }

    return new OpenAI(openaiConfig)
  }
}

// LitellmMetadata and llmMetadataContext are now in @airo/ai-common
// Re-exported here for backwards compatibility
export { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'

/**
 * Resolve the current grant userId for an LLM request.
 * Reads from the grant session manager to reflect any mid-stream grant advances,
 * falling back to the original metadata.user if no session context is available.
 */
function resolveCurrentUser(metadata: LitellmMetadata): string | undefined {
  if (metadata._internal?.socketId) {
    return grantSessionManager.getCurrentUserId(metadata._internal.socketId, metadata._internal.customerId) ?? metadata.user
  }
  return metadata.user
}

/**
 * Inject litellm_metadata into a request body, resolving the current grant userId.
 * Strips _internal fields so only user and tags are sent to GoCode.
 */
function injectLitellmMetadata(metadata: LitellmMetadata, body: Record<string, unknown>, url: string): void {
  const currentUser = resolveCurrentUser(metadata)
  body.litellm_metadata = { user: currentUser, tags: metadata.tags }
  logger.info('metadata.inject', { user: currentUser, tags: metadata.tags, url })
}

/**
 * Handle budget exceeded responses by advancing to the next grant and retrying.
 * This allows seamless continuation of agentic loops when a grant is exhausted mid-execution.
 *
 * Flow:
 * 1. Advance to next locally-cached grant
 * 2. If none available, request refresh from frontend and wait up to 5s
 * 3. Retry the single HTTP request with the new grant's userId
 *
 * @returns The retry response if successful, or null to use the original response
 */
async function handleBudgetExceededWithGrantFallback(
  response: Response,
  metadata: LitellmMetadata,
  url: RequestInfo | URL,
  init: RequestInit | undefined,
  modifiedInit: RequestInit
): Promise<Response | null> {
  if (response.status !== 400 || !metadata._internal?.socketId || !init?.body) return null

  const bodyText = await response.clone().text()
  if (!containsBudgetExceededPattern(bodyText)) return null

  const { socketId, customerId } = metadata._internal
  if (!grantSessionManager.hasGrants(socketId)) return null

  // Extract the userId from the failed request to detect concurrent advances
  let failedUserId: string | undefined
  try {
    const failedBody = JSON.parse(init.body as string)
    failedUserId = failedBody.litellm_metadata?.user
  } catch {
    return null
  }

  let newUserId: string | undefined

  // Check if another concurrent request already advanced past the failed grant.
  const currentUserId = grantSessionManager.getCurrentUserId(socketId, customerId)
  if (currentUserId && currentUserId !== failedUserId) {
    newUserId = currentUserId
    logger.info('grants.fetch.fallback.already_advanced', {
      socketId,
      failedUserId,
      currentUserId,
      message: 'Another request already advanced the grant - retrying with current'
    })
  } else {
    // Try to advance to next local grant
    let hasUsableGrant = grantSessionManager.advanceToNextGrant(socketId)

    // If no more local grants, request refresh from frontend
    if (!hasUsableGrant) {
      logger.info('grants.fetch.fallback.requesting_refresh', {
        socketId,
        message: 'No more local grants - requesting refresh from frontend'
      })

      const gotNewGrants = await grantSessionManager.requestGrantRefreshAndWait(socketId, 5000)
      if (gotNewGrants) {
        hasUsableGrant = grantSessionManager.getCurrentUserId(socketId, customerId) !== undefined
      }
    }

    if (!hasUsableGrant) {
      logger.warn('grants.fetch.fallback.all_exhausted', {
        socketId,
        message: 'Budget exceeded and no grants available after refresh'
      })
      return null
    }

    newUserId = grantSessionManager.getCurrentUserId(socketId, customerId)
  }

  if (!newUserId) return null

  logger.info('grants.fetch.fallback.retry', {
    socketId,
    previousUser: failedUserId,
    newUser: newUserId,
    message: 'Budget exceeded - switching to next grant and retrying request'
  })

  try {
    const originalBody = JSON.parse(init.body as string)
    originalBody.litellm_metadata = { user: newUserId, tags: metadata.tags }
    const retryBody = JSON.stringify(originalBody)
    // Remove budget headers on grant fallback -- grant-funded requests must not
    // attribute cost to the exhausted BMS session
    const retryHeaders = new Headers(modifiedInit.headers as HeadersInit)
    retryHeaders.delete('x-gocode-budget-service-name')
    retryHeaders.delete('x-gocode-budget-id')
    retryHeaders.set('x-correlation-id', crypto.randomUUID())
    const retryInit: RequestInit = { ...modifiedInit, body: retryBody, headers: retryHeaders }
    return await llmFetch(url, retryInit)
  } catch (retryError) {
    logger.error('grants.fetch.fallback.retry_failed', {
      socketId,
      error: retryError instanceof Error ? retryError.message : String(retryError)
    })
    return null
  }
}

/**
 * Create a fetch wrapper that injects current S2S token on every request
 * and handles token refresh on authentication errors
 * Also injects litellm_metadata for cost tracking when available
 * Optionally blocks specific anthropic-beta headers for proxy compatibility
 */
function createS2SFetchWrapper(s2sAuthConfig?: S2SAuthConfig, options?: { blockedBetaHeaders?: string[] }): typeof fetch {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    // Convert to Headers instance for consistent API
    const headers = new Headers(init?.headers)

    // Always inject the current valid token before making the request
    const currentToken = await getS2SToken(s2sAuthConfig)
    headers.set('Authorization', `Bearer ${currentToken}`)

    filterAnthropicBetaHeaders(headers, options?.blockedBetaHeaders)

    // Inject BMS cost-reporting headers when budget session is active
    // Set before first fetch so they persist across 401 retries and grant-fallback retries
    const metadata = llmMetadataContext.getStore()
    if (metadata?.budgetSessionId) {
      headers.set('x-gocode-budget-service-name', 'airo-app-builder')
      headers.set('x-gocode-budget-id', metadata.budgetSessionId)
    }

    if (metadata?.traceId) {
      headers.set('x-trace-id', metadata.traceId)
    }

    // Per-call correlation ID for GoCode log drill-down (highest priority in GoCode's middleware)
    headers.set('x-correlation-id', crypto.randomUUID())

    // Inject litellm_metadata into request body if available from AsyncLocalStorage context
    const modifiedInit: RequestInit = { ...init, headers }

    if (metadata && init?.body) {
      try {
        const body = JSON.parse(init.body as string)
        injectLitellmMetadata(metadata, body, typeof url === 'string' ? url : url.toString())
        modifiedInit.body = JSON.stringify(body)
      } catch (error) {
        logger.warn('metadata.inject.failure', { error: error instanceof Error ? error.message : String(error) })
      }
    } else if (!metadata && init?.body) {
      logger.warn('metadata.missing', {
        url: typeof url === 'string' ? url : url.toString()
      })
    }

    // Make request with Headers instance and modified body
    let response = await llmFetch(url, modifiedInit)

    // Handle budget exceeded with grant fallback
    if (metadata) {
      const retryResponse = await handleBudgetExceededWithGrantFallback(response, metadata, url, init, modifiedInit)
      if (retryResponse) {
        response = retryResponse
        // Clear budget headers from shared headers object -- grant-funded requests
        // must not attribute cost to the exhausted BMS session on subsequent 401 retry
        headers.delete('x-gocode-budget-service-name')
        headers.delete('x-gocode-budget-id')
      }
    }

    // Attempt token refresh on authentication failure
    if (response.status === 401 || response.status === 403) {
      // Consume the failed response to prevent issues
      try {
        await response.arrayBuffer()
      } catch {
        // Ignore errors consuming the response body
      }

      // Refresh token and retry. modifiedInit shares the headers object so the
      // original x-correlation-id is preserved -- do not clone headers here.
      const newToken = await refreshS2SToken(s2sAuthConfig)
      headers.set('Authorization', `Bearer ${newToken}`)
      return await llmFetch(url, modifiedInit)
    }

    return response
  }
}


/**
 * Create a fetch wrapper that selectively blocks specific anthropic-beta headers for proxy compatibility.
 * Used for non-S2S Anthropic API calls through GoCode proxy.
 * Also injects litellm_metadata for cost tracking when available.
 *
 * @param blockedHeaders - List of anthropic-beta header values to filter out
 * @param baseFetch - Base fetch function to use (defaults to llmFetch, injectable for testing)
 */
export function createSelectiveBetaHeaderFetch(
  blockedHeaders?: string[],
  baseFetch: typeof fetch = llmFetch
): typeof fetch {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    // Convert to Headers instance for consistent API
    const headers = new Headers(init?.headers)

    filterAnthropicBetaHeaders(headers, blockedHeaders)

    // Inject BMS cost-reporting headers when budget session is active
    const metadata = llmMetadataContext.getStore()
    if (metadata?.budgetSessionId) {
      headers.set('x-gocode-budget-service-name', 'airo-app-builder')
      headers.set('x-gocode-budget-id', metadata.budgetSessionId)
    }

    if (metadata?.traceId) {
      headers.set('x-trace-id', metadata.traceId)
    }

    // Per-call correlation ID for GoCode log drill-down (highest priority in GoCode's middleware)
    headers.set('x-correlation-id', crypto.randomUUID())

    // Inject litellm_metadata into request body if available from AsyncLocalStorage context
    const modifiedInit: RequestInit = { ...init, headers }

    if (metadata && init?.body) {
      try {
        const body = JSON.parse(init.body as string)
        injectLitellmMetadata(metadata, body, typeof url === 'string' ? url : url.toString())
        modifiedInit.body = JSON.stringify(body)
      } catch (error) {
        logger.warn('metadata.inject.failure', { error: error instanceof Error ? error.message : String(error) })
      }
    }

    // Make request with modified headers and body
    let response = await baseFetch(url, modifiedInit)

    // Handle budget exceeded with grant fallback
    if (metadata) {
      const retryResponse = await handleBudgetExceededWithGrantFallback(response, metadata, url, init, modifiedInit)
      if (retryResponse) response = retryResponse
    }

    return response
  }
}

function filterAnthropicBetaHeaders(headers: Headers, blockedHeaders?: string[]) {
  if (!blockedHeaders?.length || !headers.has('anthropic-beta')) {
    return
  }

  const betaValue = headers.get('anthropic-beta')
  if (!betaValue) {
    return
  }

  const values = betaValue.split(',').map(v => v.trim())
  const filteredValues = values.filter(value =>
    !blockedHeaders.some(blocked => value.includes(blocked))
  )

  if (filteredValues.length === 0) {
    headers.delete('anthropic-beta')
  } else if (filteredValues.length !== values.length) {
    headers.set('anthropic-beta', filteredValues.join(','))
  }
}

function createAnthropicFetch(options: { useS2S: boolean; s2sAuthConfig?: S2SAuthConfig; blockedBetaHeaders: string[] }): typeof fetch {
  if (options.useS2S) {
    return createS2SFetchWrapper(options.s2sAuthConfig, {
      blockedBetaHeaders: options.blockedBetaHeaders
    })
  }

  return createSelectiveBetaHeaderFetch(options.blockedBetaHeaders)
}

/**
 * Create OpenAI-compatible provider for LiteLLM
 * Now supports S2S authentication when GOCODE_USE_S2S_AUTH is enabled
 * Includes automatic token refresh on authentication failures
 */
async function createOpenAIProvider(config?: ProviderConfig) {
  // Check if S2S authentication is enabled and get config
  const s2sConfig = await getS2SProviderConfig(config?.s2sAuth)

  if (s2sConfig) {
    // Use S2S authentication with GoCode endpoint
    const openaiConfig: any = {
      name: 'litellm',
      apiKey: s2sConfig.apiKey, // Placeholder API key
      baseURL: s2sConfig.baseURL.endsWith('/v1') ? s2sConfig.baseURL : s2sConfig.baseURL + '/v1', // Ensure /v1 suffix
      fetch: createS2SFetchWrapper(config?.s2sAuth), // Custom fetch with token injection and refresh
      includeUsage: true // Include token usage in streaming responses
    }

    logger.info('provider.s2s.openai', { baseURL: openaiConfig.baseURL })
    return createOpenAICompatible(openaiConfig)

  } else {
    // Use regular OpenAI authentication
    const fallbackApiKey = config?.openaiApiKey || process.env.OPENAI_API_KEY || ''

    const openaiConfig: any = {
      name: 'litellm',
      apiKey: fallbackApiKey,
      fetch: llmFetch,
      includeUsage: true // Include token usage in streaming responses
    }

    // Add base URL if provided (for proxy support)
    const baseURL = config?.openaiBaseUrl || process.env.OPENAI_BASE_URL
    if (baseURL) {
      // Ensure URL ends with /v1 for OpenAI API compatibility
      openaiConfig.baseURL = baseURL.endsWith('/v1') ? baseURL : baseURL + '/v1'
    }

    return createOpenAICompatible(openaiConfig)
  }
}


/**
 * Unified model provider function
 *
 * @param modelName - Short model name or full model identifier
 * @param config - Optional configuration overrides
 * @returns Language model instance
 *
 * @example
 * ```typescript
 * // OpenAI models (with proxy support)
 * const gpt4 = await getModel('gpt4o')
 * const gpt4WithProxy = await getModel('gpt4o', {
 *   openaiBaseUrl: 'https://proxy.example.com'
 * })
 *
 * // Claude models
 * // Automatically routes to Anthropic API or proxy based on available credentials
 * const claude = await getModel('claude-sonnet-4-6')
 * const claudeViaProxy = await getModel('claude-sonnet-4-6')  // Uses proxy when configured
 * ```
 */
export async function getModel(
  modelName: string,
  config?: ProviderConfig
): Promise<LanguageModel> {
  const providerType = getProviderType(modelName, config)

  try {
    if (providerType === 'openai') {
      // Validate OpenAI configuration
      validateOpenAIConfig(config)

      // Determine the model name to use
      let modelNameToUse: string

      if (shouldUseClaudeProxy(modelName, config)) {
        // Use Claude proxy model name
        modelNameToUse = CLAUDE_PROXY_MODELS[modelName as keyof typeof CLAUDE_PROXY_MODELS]
        logger.info('provider.proxy.openai', { modelName, modelNameToUse })
      } else {
        // Use regular OpenAI model mapping
        modelNameToUse = MODEL_MAPPINGS[modelName as ModelShortName] || modelName
      }

      // Create OpenAI provider
      const provider = await createOpenAIProvider(config)
      return wrapLanguageModel({
        model: provider(modelNameToUse),
        middleware: createCostTrackingMiddleware()
      })

    } else if (providerType === 'anthropic') {
      // Validate Anthropic configuration
      validateAnthropicConfig(config)

      // Determine the model name to use
      let modelNameToUse: string

      // Check if this is a Claude model that we're routing to Anthropic
      if (modelName in CLAUDE_PROXY_MODELS) {
        // Use Claude proxy model name for Anthropic API
        modelNameToUse = CLAUDE_PROXY_MODELS[modelName as keyof typeof CLAUDE_PROXY_MODELS]
        logger.info('provider.anthropic', { modelName, modelNameToUse })
      } else {
        // Use regular model mapping
        modelNameToUse = MODEL_MAPPINGS[modelName as ModelShortName] || modelName
      }

      // Create Anthropic provider
      const provider = await createAnthropicProvider(config)
      return wrapLanguageModel({
        model: provider(modelNameToUse),
        middleware: createCostTrackingMiddleware()
      })

    } else {
      throw new Error(`Unsupported provider type: ${providerType}`)
    }
  } catch (error) {
    throw new Error(`Failed to create model '${modelName}': ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Get available model short names
 */
export function getAvailableModels(): string[] {
  return getAvailableModelsFromNormalization()
}

/**
 * Check if a model name is supported
 */
export function isModelSupported(modelName: string): boolean {
  return isModelSupportedFromNormalization(modelName)
}

/**
 * Get the full model identifier from a short name
 */
export function getFullModelName(shortName: string): string {
  return getFullModelNameFromNormalization(shortName)
}

/**
 * Validate environment for a specific model
 */
export function validateModelEnvironment(modelName: string, config?: ProviderConfig): boolean {
  const providerType = getProviderType(modelName, config)

  try {
    if (providerType === 'openai') {
      validateOpenAIConfig(config)
    } else if (providerType === 'anthropic') {
      validateAnthropicConfig(config)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Validate Anthropic configuration
 * Skips API key validation when S2S authentication is enabled
 */
function validateAnthropicConfig(config?: ProviderConfig): void {
  // Skip API key validation if S2S authentication is enabled
  if (isS2SAuthEnabled()) {
    return;
  }

  const apiKey = config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass anthropicApiKey in config.')
  }
}

/**
 * Create Anthropic provider with configuration
 * Now supports S2S authentication when GOCODE_USE_S2S_AUTH is enabled
 * Includes automatic token refresh on authentication failures
 */
async function createAnthropicProvider(config?: ProviderConfig) {
  const blockedAnthropicBetaHeaders = config?.blockedAnthropicBetaHeaders ?? DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS

  // Check if S2S authentication is enabled and get config
  const s2sConfig = await getS2SProviderConfig(config?.s2sAuth)

  const anthropicFetch = createAnthropicFetch({
    useS2S: !!s2sConfig,
    ...(config?.s2sAuth ? { s2sAuthConfig: config.s2sAuth } : {}),
    blockedBetaHeaders: blockedAnthropicBetaHeaders
  })

  if (s2sConfig) {
    // Use S2S authentication with GoCode endpoint
    const anthropicConfig: any = {
      apiKey: s2sConfig.apiKey, // Placeholder API key
      baseURL: s2sConfig.baseURL.endsWith('/v1') ? s2sConfig.baseURL : s2sConfig.baseURL + '/v1', // Ensure /v1 suffix
      fetch: anthropicFetch
    }

    logger.info('provider.s2s.anthropic', { baseURL: anthropicConfig.baseURL })
    return createAnthropic(anthropicConfig)

  } else {
    // Use regular Anthropic authentication
    const fallbackApiKey = config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || ''

    const anthropicConfig: any = {
      apiKey: fallbackApiKey,
      fetch: llmFetch
    }

    // Add base URL - use GoCode Anthropic proxy endpoint if no explicit override
    const baseURL = config?.anthropicBaseUrl || process.env.ANTHROPIC_BASE_URL || getDefaultAnthropicProxyEndpoint()
    if (baseURL) {
      // Ensure URL ends with /v1 for Anthropic API compatibility
      anthropicConfig.baseURL = baseURL.endsWith('/v1') ? baseURL : baseURL + '/v1'
      logger.info('provider.proxy.anthropic', { baseURL: anthropicConfig.baseURL })

      // Use custom fetch to selectively block anthropic-beta headers for proxy compatibility
      anthropicConfig.fetch = anthropicFetch
    }

    return createAnthropic(anthropicConfig)
  }
}


/**
 * Get model information
 */
export function getModelInfo(modelName: string, config?: ProviderConfig) {
  const providerType = getProviderType(modelName, config)
  const proxyType = getClaudeProxyType(modelName, config)

  let fullModelName: string
  let usingProxy = false
  let proxyReason = ''

  if (proxyType) {
    fullModelName = CLAUDE_PROXY_MODELS[modelName as keyof typeof CLAUDE_PROXY_MODELS]
    usingProxy = true
    if (proxyType === 'openai') {
      proxyReason = 'AWS and Anthropic not available, using OpenAI proxy'
    } else if (proxyType === 'anthropic') {
      proxyReason = 'AWS not available, using Anthropic API directly'
    }
  } else {
    fullModelName = getFullModelNameFromNormalization(modelName)
  }

  return {
    shortName: modelName,
    fullName: fullModelName,
    provider: providerType,
    isSupported: isModelSupported(modelName),
    usingProxy,
    ...(usingProxy && { proxyReason })
  }
}

/**
 * Embedding model mappings
 */
const EMBEDDING_MODEL_MAPPINGS = {
  'titan-embed-v1': 'amazon.titan-embed-text-v1',
  'titan-embed-v2': 'amazon.titan-embed-text-v2:0',
  'titan-embed': 'amazon.titan-embed-text-v2:0',
  'cohere-embed-english': 'cohere.embed-english-v3',
  'cohere-embed-multilingual': 'cohere.embed-multilingual-v3',
  'text-embedding-ada-002': 'text-embedding-ada-002',
  'text-embedding-3-small': 'text-embedding-3-small',
  'text-embedding-3-large': 'text-embedding-3-large'
} as const

type EmbeddingModelShortName = keyof typeof EMBEDDING_MODEL_MAPPINGS

/**
 * Get an embedding model instance
 *
 * @param modelName - Short model name or full model identifier
 * @param config - Optional configuration overrides
 * @returns Embedding model instance compatible with AI SDK
 *
 * @example
 * ```typescript
 * // Get OpenAI embedding model
 * const openaiModel = await getEmbeddingModel('text-embedding-3-small')
 *
 * // Use with embeddings utility
 * import { generateEmbeddings } from '@airo/ai-lib'
 * const result = await generateEmbeddings(['text to embed'], openaiModel)
 * ```
 */
export async function getEmbeddingModel(
  modelName: string,
  config?: ProviderConfig
): Promise<any> {
  const fullModelName = EMBEDDING_MODEL_MAPPINGS[modelName as EmbeddingModelShortName] || modelName

  if (fullModelName.startsWith('text-embedding')) {
    validateOpenAIConfig(config)
    const provider = await createOpenAIProvider(config)
    return provider.embeddingModel(fullModelName)
  } else {
    throw new Error(`Unsupported embedding model: ${modelName}`)
  }
}

// @visibleForTesting
export const __test__ = {
  createS2SFetchWrapper,
  createSelectiveBetaHeaderFetch,
}
