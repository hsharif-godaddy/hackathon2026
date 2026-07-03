/**
 * Logo Service — HTTP client for gai-logo-agent.
 *
 * V1 (legacy): `generate()` calls POST /api/logo/create (multi-layout, flat-keyed response).
 * V3: `generateV3()`, `editV3()`, `generateVariantV3()` call the v3 endpoints
 *     (single-layout per call; response uses flat `transparentUrl`/`mockupUrl` keys
 *     mapped into `urls[requestedLayout]`).
 *
 * The media-logo skill tool consumes the public types (LayoutUrls,
 * ProcessedLogo, LogoSessionResponse). V3 methods share a private
 * `callV3Endpoint` helper for auth, timeout, retry-eligible error handling,
 * and response mapping.
 */

import { getS2SToken } from '@airo/ai-lib'
import { BudgetExceededError } from '@airo/ai-common'

import { logger } from '../logging/index.js'
import { resolveEnv } from '../utils/gd-env.js'

export type LogoLayout = 'square' | 'horizontal' | 'vertical'
export type LogoVariant = LogoLayout | 'favicon'

export interface LayoutUrls {
  transparent: string
  solid?: string
  mockup?: string
  landscapeMockup?: string
}

/**
 * Structured brand colors sent to the logo API so it can render a mark that
 * reads on the surface it lands on (`background`) and harmonizes with the brand
 * (`primary`/`secondary`/`accent`). All optional — only populated roles are sent.
 *
 * NOTE: the shape is provisional until gai-logo-agent defines the contract;
 * the send is gated by the `appbuilder-logo-brand-colors` switchboard flag
 * (default off), surfaced on context.metadata and read in the media-logo tool.
 */
export interface LogoColors {
  primary?: string
  secondary?: string
  accent?: string
  background?: string
}

interface BaseV3Input {
  appId: string
  customerId: string
  budgetUserId: string
  colors?: LogoColors
  brandName?: string
  traceparent?: string
  conversationId?: string
  signal?: AbortSignal
}

export interface GenerateV3Input extends BaseV3Input {
  prompt: string
  layout: LogoLayout
  inspiration?: string[]
}

export interface EditV3Input extends BaseV3Input {
  sourceUrl: string
  prompt: string
  layout: LogoLayout
  inspiration?: string[]
}

export interface GenerateVariantV3Input extends BaseV3Input {
  sourceUrl: string
  variant: LogoVariant
  prompt?: string
}

export interface GenerateLogoInput {
  prompt: string
  layout: LogoLayout[]
  references?: {
    logo?: string
    inspiration?: string[]
  }
  colors?: LogoColors
  brandName?: string
  appId: string
  customerId: string
  budgetUserId: string
  /**
   * W3C traceparent (`00-<traceId>-<spanId>-01`) for the originating agent turn.
   * Forwarded to the logo API so it can nest its LLM/image observations under
   * the caller's Langfuse trace (the `media-logo__generate_logo` tool span).
   */
  traceparent?: string
  /** Conversation id of the originating turn, forwarded for Langfuse correlation. */
  conversationId?: string
  /** Optional external cancellation signal (combined with the request timeout). */
  signal?: AbortSignal
}

export interface ProcessedLogo {
  id: string
  generatedAt: string
  prompt: string
  modelUsed: string
  urls: Partial<Record<LogoLayout, LayoutUrls>>
}

export interface LogoSessionResponse {
  sessionId: string
  logo: ProcessedLogo
}

const logoUrls = {
  dev: 'https://logo-agent.mvci.api.dev-godaddy.com',
  test: 'https://logo-agent.mvci.api.test-godaddy.com',
  prod: 'https://logo-agent.mvci.api.godaddy.com',
} as const

function getLogoApiBaseUrl(): string {
  if (process.env.LOGO_API_URL) return process.env.LOGO_API_URL
  return logoUrls[resolveEnv()]
}

const REQUEST_TIMEOUT_MS = 240_000
const MODEL_USED_LABEL = 'logo-agent'

/** Flat-keyed ProcessedLogo as returned by the upstream API. */
interface ApiProcessedLogo {
  id: string
  // Square
  transparentUrl?: string
  solidUrl?: string
  mockupUrl?: string
  landscapeMockupUrl?: string
  // Horizontal
  horizontalTransparentUrl?: string
  horizontalSolidUrl?: string
  horizontalMockupUrl?: string
  horizontalLandscapeMockupUrl?: string
  // Vertical
  verticalTransparentUrl?: string
  verticalSolidUrl?: string
  verticalMockupUrl?: string
  verticalLandscapeMockupUrl?: string
}

interface ApiResponse {
  id: string
  sessionId: string
  logos: ApiProcessedLogo[]
}

interface V3ApiProcessedLogo {
  id: string
  generatedAt?: string
  prompt?: string
  modelUsed?: string
  transparentUrl?: string
  mockupUrl?: string
}

interface V3ApiResponse {
  id: string
  sessionId: string
  logos: V3ApiProcessedLogo[]
}

/**
 * Map the upstream's flat keys into our per-layout LayoutUrls bundle.
 * Returns undefined when the layout's transparent variant is missing —
 * that variant is required and its absence means the API didn't produce
 * the layout. Other variants fall back to the most relevant sibling so
 * the manifest never ends up with empty strings.
 */
function pickUrls(logo: ApiProcessedLogo, layout: LogoLayout): LayoutUrls | undefined {
  if (layout === 'square') {
    if (!logo.transparentUrl) return undefined
    return {
      transparent: logo.transparentUrl,
      solid: logo.solidUrl ?? logo.transparentUrl,
      mockup: logo.mockupUrl ?? logo.transparentUrl,
      landscapeMockup: logo.landscapeMockupUrl ?? logo.mockupUrl ?? logo.transparentUrl,
    }
  }
  if (layout === 'horizontal') {
    if (!logo.horizontalTransparentUrl) return undefined
    // Prefer the per-layout field. The single-field reconstruction
    // (landscapeMockupUrl is this layout's only when no higher-priority layout
    // is present) is a fallback for the gap before gai-logo-agent's per-layout
    // fields are deployed.
    // TODO(GAI-1634): drop the single-field reconstruction once gai-logo-agent
    // per-layout landscape fields are deployed everywhere.
    const landscape: string | undefined =
      logo.horizontalLandscapeMockupUrl ?? (logo.transparentUrl ? undefined : logo.landscapeMockupUrl)
    return {
      transparent: logo.horizontalTransparentUrl,
      solid: logo.horizontalSolidUrl ?? logo.horizontalTransparentUrl,
      mockup: logo.horizontalMockupUrl ?? logo.horizontalTransparentUrl,
      landscapeMockup: landscape ?? logo.horizontalMockupUrl ?? logo.horizontalTransparentUrl,
    }
  }
  if (!logo.verticalTransparentUrl) return undefined
  // Prefer the per-layout field; same deploy-gap fallback as horizontal
  // (see TODO(GAI-1634) above) — vertical claims the single landscapeMockupUrl
  // only when neither square nor horizontal is present.
  const landscape: string | undefined =
    logo.verticalLandscapeMockupUrl ??
    (logo.transparentUrl || logo.horizontalTransparentUrl ? undefined : logo.landscapeMockupUrl)
  return {
    transparent: logo.verticalTransparentUrl,
    solid: logo.verticalSolidUrl ?? logo.verticalTransparentUrl,
    mockup: logo.verticalMockupUrl ?? logo.verticalTransparentUrl,
    landscapeMockup: landscape ?? logo.verticalMockupUrl ?? logo.verticalTransparentUrl,
  }
}

class LogoService {
  private readonly appKey = 'airo-app-builder'

  async generate(input: GenerateLogoInput): Promise<LogoSessionResponse> {
    const url = `${getLogoApiBaseUrl().replace(/\/$/, '')}/api/logo/create`
    const hasColors = Boolean(input.colors && Object.keys(input.colors).length > 0)
    const hasReferences = Boolean(
      input.references && (input.references.logo || (input.references.inspiration && input.references.inspiration.length > 0))
    )
    const body: Record<string, unknown> = {
      prompt: input.prompt,
      layout: input.layout,
      ...(hasReferences && { references: input.references }),
      ...(hasColors && { colors: input.colors }),
      ...(input.brandName && { brandName: input.brandName }),
    }

    logger.info('logo.generate.begin', {
      appId: input.appId,
      customerId: input.customerId,
      budgetUserId: input.budgetUserId,
      promptLength: input.prompt.length,
      layouts: input.layout,
      hasReferenceLogo: Boolean(input.references?.logo),
      inspirationCount: input.references?.inspiration?.length ?? 0,
      hasColors,
    })

    let response: Response
    try {
      const token = await getS2SToken()
      const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      const signal = input.signal
        ? AbortSignal.any([timeoutSignal, input.signal])
        : timeoutSignal
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'x-app-key': this.appKey,
          'x-app-builder-app-id': input.appId,
          'x-customer-id': input.customerId,
          'x-budget-user-id': input.budgetUserId,
          // Trace context for cross-service Langfuse nesting. The logo API reads
          // these to emit its model calls as children of this turn's trace; it
          // ignores them when absent, so this is backward-compatible.
          ...(input.traceparent && { traceparent: input.traceparent }),
          ...(input.conversationId && { 'x-conversation-id': input.conversationId }),
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        logger.error('logo.generate.timeout', {
          customerId: input.customerId,
          timeoutMs: REQUEST_TIMEOUT_MS,
        })
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        logger.error('logo.generate.aborted', { customerId: input.customerId })
      } else {
        logger.error('logo.generate.error', {
          customerId: input.customerId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      throw err instanceof Error ? err : new Error(String(err))
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      if (response.status === 402) {
        logger.warn('logo.generate.budget_exceeded', {
          customerId: input.customerId,
          budgetUserId: input.budgetUserId,
        })
        throw new BudgetExceededError('Logo generation budget exceeded', 402, text)
      }
      logger.error('logo.generate.api_error', {
        status: response.status,
        error: text.slice(0, 500),
        customerId: input.customerId,
      })
      // Keep the upstream body in the log only — the thrown message surfaces
      // to the user via the tool's `{ error }`, so don't leak raw API detail.
      throw new Error(`Logo generation failed (status ${response.status})`)
    }

    const result = (await response.json()) as ApiResponse
    const apiLogo = result.logos?.[0]
    if (!apiLogo) {
      logger.error('logo.generate.empty_logos', {
        sessionId: result.sessionId,
        customerId: input.customerId,
      })
      throw new Error('Logo API returned no logos')
    }

    const urls: Partial<Record<LogoLayout, LayoutUrls>> = {}
    const droppedLayouts: LogoLayout[] = []
    for (const layout of input.layout) {
      const layoutUrls = pickUrls(apiLogo, layout)
      if (layoutUrls) {
        urls[layout] = layoutUrls
      } else {
        droppedLayouts.push(layout)
      }
    }
    if (droppedLayouts.length > 0) {
      logger.warn('logo.generate.layouts_dropped', {
        appId: input.appId,
        sessionId: result.sessionId,
        logoId: apiLogo.id,
        requested: input.layout,
        dropped: droppedLayouts,
      })
    }

    logger.info('logo.generate.success', {
      appId: input.appId,
      sessionId: result.sessionId,
      logoId: apiLogo.id,
      layouts: input.layout,
    })

    return {
      sessionId: result.sessionId,
      logo: {
        id: apiLogo.id,
        generatedAt: new Date().toISOString(),
        prompt: input.prompt,
        modelUsed: MODEL_USED_LABEL,
        urls,
      },
    }
  }

  async generateV3(input: GenerateV3Input): Promise<LogoSessionResponse> {
    const hasColors = Boolean(input.colors && Object.keys(input.colors).length > 0)
    const body: Record<string, unknown> = {
      prompt: input.prompt,
      variant: input.layout,
      ...(input.inspiration?.length && { inspiration: input.inspiration }),
      ...(hasColors && { colors: input.colors }),
      ...(input.brandName && { brandName: input.brandName }),
    }

    logger.info('logo.generateV3.begin', {
      appId: input.appId,
      customerId: input.customerId,
      budgetUserId: input.budgetUserId,
      promptLength: input.prompt.length,
      variant: input.layout,
      inspirationCount: input.inspiration?.length ?? 0,
      hasColors,
    })

    return this.callV3Endpoint('/api/v3/logo/generate', body, input, 'logo.generateV3', input.layout)
  }

  async editV3(input: EditV3Input): Promise<LogoSessionResponse> {
    const hasColors = Boolean(input.colors && Object.keys(input.colors).length > 0)
    const body: Record<string, unknown> = {
      sourceUrl: input.sourceUrl,
      prompt: input.prompt,
      variant: input.layout,
      ...(input.inspiration?.length && { inspiration: input.inspiration }),
      ...(hasColors && { colors: input.colors }),
      ...(input.brandName && { brandName: input.brandName }),
    }

    logger.info('logo.editV3.begin', {
      appId: input.appId,
      customerId: input.customerId,
      budgetUserId: input.budgetUserId,
      promptLength: input.prompt.length,
      layout: input.layout,
      hasColors,
    })

    return this.callV3Endpoint('/api/v3/logo/edit', body, input, 'logo.editV3', input.layout)
  }

  async generateVariantV3(input: GenerateVariantV3Input): Promise<LogoSessionResponse> {
    const hasColors = Boolean(input.colors && Object.keys(input.colors).length > 0)
    const body: Record<string, unknown> = {
      sourceUrl: input.sourceUrl,
      variant: input.variant,
      ...(input.brandName && { brandName: input.brandName }),
      ...(input.prompt && { prompt: input.prompt }),
      ...(hasColors && { colors: input.colors }),
    }

    logger.info('logo.generateVariantV3.begin', {
      appId: input.appId,
      customerId: input.customerId,
      budgetUserId: input.budgetUserId,
      variant: input.variant,
      hasColors,
    })

    return this.callV3Endpoint('/api/v3/logo/generate_variant', body, input, 'logo.generateVariantV3', 'square')
  }

  private async callV3Endpoint(
    path: string,
    body: Record<string, unknown>,
    input: { appId: string; customerId: string; budgetUserId: string; prompt?: string; traceparent?: string; conversationId?: string; signal?: AbortSignal },
    logPrefix: string,
    targetLayout: LogoLayout,
  ): Promise<LogoSessionResponse> {
    const url = `${getLogoApiBaseUrl().replace(/\/$/, '')}${path}`

    let response: Response
    try {
      const token = await getS2SToken()
      const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      const signal = input.signal
        ? AbortSignal.any([timeoutSignal, input.signal])
        : timeoutSignal
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'x-app-key': this.appKey,
          'x-app-builder-app-id': input.appId,
          'x-customer-id': input.customerId,
          'x-budget-user-id': input.budgetUserId,
          ...(input.traceparent && { traceparent: input.traceparent }),
          ...(input.conversationId && { 'x-conversation-id': input.conversationId }),
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        logger.error(`${logPrefix}.timeout`, { customerId: input.customerId, timeoutMs: REQUEST_TIMEOUT_MS })
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        logger.error(`${logPrefix}.aborted`, { customerId: input.customerId })
      } else {
        logger.error(`${logPrefix}.error`, { customerId: input.customerId, error: err instanceof Error ? err.message : String(err) })
      }
      throw err instanceof Error ? err : new Error(String(err))
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      if (response.status === 402) {
        logger.warn(`${logPrefix}.budget_exceeded`, { customerId: input.customerId, budgetUserId: input.budgetUserId })
        throw new BudgetExceededError('Logo generation budget exceeded', 402, text)
      }
      logger.error(`${logPrefix}.api_error`, { status: response.status, error: text.slice(0, 500), customerId: input.customerId })
      throw new Error(`Logo API call failed (status ${response.status})`)
    }

    const result = (await response.json()) as V3ApiResponse
    if (!result.sessionId) {
      logger.error(`${logPrefix}.missing_session_id`, { customerId: input.customerId })
      throw new Error('Logo API returned no sessionId')
    }
    const apiLogo = result.logos?.[0]
    if (!apiLogo) {
      logger.error(`${logPrefix}.empty_logos`, { sessionId: result.sessionId, customerId: input.customerId })
      throw new Error('Logo API returned no logos')
    }

    const transparentUrl = apiLogo.transparentUrl
    if (!transparentUrl) {
      logger.error(`${logPrefix}.no_transparent`, { sessionId: result.sessionId, customerId: input.customerId })
      throw new Error('Logo API returned no transparent URL')
    }

    logger.info(`${logPrefix}.success`, { appId: input.appId, sessionId: result.sessionId, logoId: apiLogo.id })

    return {
      sessionId: result.sessionId,
      logo: {
        id: apiLogo.id,
        generatedAt: apiLogo.generatedAt ?? new Date().toISOString(),
        prompt: apiLogo.prompt ?? input.prompt ?? '',
        modelUsed: apiLogo.modelUsed ?? MODEL_USED_LABEL,
        urls: {
          [targetLayout]: {
            transparent: transparentUrl,
            mockup: apiLogo.mockupUrl ?? transparentUrl,
          },
        },
      },
    }
  }
}

export const logoService = new LogoService()
