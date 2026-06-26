/**
 * Logo Service — calls POST /api/logo/create on gai-logo-agent.
 *
 * The endpoint takes a natural-language prompt + layouts (+ optional
 * `referenceUrl` for edits) and returns hosted variant URLs per layout.
 * No OpenAI calls or workspace uploads happen here — the API owns image
 * generation and hosting end-to-end.
 *
 * The media-logo skill tool consumes the public types (LayoutUrls,
 * ProcessedLogo, LogoSessionResponse). Internally we map the API's
 * flat-keyed ProcessedLogo (e.g. `horizontalTransparentUrl`) into
 * per-layout `urls.{square,horizontal,vertical}` bundles.
 */

import { getS2SToken } from '@airo/ai-lib'
import { BudgetExceededError } from '@airo/ai-common'

import { logger } from '../logging/index.js'
import { resolveEnv } from '../utils/gd-env.js'

export type LogoLayout = 'square' | 'horizontal' | 'vertical'

export interface LayoutUrls {
  transparent: string
  solid: string
  mockup: string
  landscapeMockup: string
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
  // Vertical
  verticalTransparentUrl?: string
  verticalSolidUrl?: string
  verticalMockupUrl?: string
}

interface ApiResponse {
  id: string
  sessionId: string
  logos: ApiProcessedLogo[]
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
    return {
      transparent: logo.horizontalTransparentUrl,
      solid: logo.horizontalSolidUrl ?? logo.horizontalTransparentUrl,
      mockup: logo.horizontalMockupUrl ?? logo.horizontalTransparentUrl,
      landscapeMockup: logo.horizontalMockupUrl ?? logo.horizontalTransparentUrl,
    }
  }
  if (!logo.verticalTransparentUrl) return undefined
  return {
    transparent: logo.verticalTransparentUrl,
    solid: logo.verticalSolidUrl ?? logo.verticalTransparentUrl,
    mockup: logo.verticalMockupUrl ?? logo.verticalTransparentUrl,
    landscapeMockup: logo.verticalMockupUrl ?? logo.verticalTransparentUrl,
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
}

export const logoService = new LogoService()
