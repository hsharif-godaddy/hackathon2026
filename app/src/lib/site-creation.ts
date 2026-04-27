import { AuthDismissedError } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { getByteLength, MAX_PROMPT_BYTES } from '@/lib/waf-validation'
import { buildDevelopUrl, fetchQuickCreate, type QuickCreateResponse, setQuickCreateSessionFlags } from './quick-create'

export interface CreateSiteOptions {
  prompt: string
  templateId?: string
  productId?: string
  source?: string // Analytics source tracking (e.g., 'homepage', 'create-page')
  onAuthRequired?: (prompt: string) => void
  onError?: (error: string) => void
  onSuccess?: (siteId: string, siteType: string) => void
}

interface Router {
  push: (href: string) => void
}

export async function createSiteAndRedirect(
  options: CreateSiteOptions,
  router: Router
): Promise<void> {
  const { prompt, templateId, productId, source = 'unknown', onAuthRequired, onError, onSuccess } = options

  try {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) {
      const error = 'Prompt cannot be empty'
      logger.warn('site-creation.validation.empty', { source })
      onError?.(error)
      return
    }

    const promptByteLength = getByteLength(normalizedPrompt)
    if (promptByteLength > MAX_PROMPT_BYTES) {
      const error = `Prompt is too large (${promptByteLength} bytes, max ${MAX_PROMPT_BYTES} bytes)`
      logger.warn('site-creation.validation.too-large', {
        promptByteLength,
        maxBytes: MAX_PROMPT_BYTES,
        source,
      })
      onError?.(error)
      return
    }

    logger.info('site-creation.start', {
      promptLength: normalizedPrompt.length,
      promptByteLength,
      source,
      hasTemplate: !!templateId,
      hasProductId: !!productId,
    })

    // Level 3: mgmt-airo requires HBI for site creation. Preflight ensures
    // SSO opens for re-auth before the request fires (else the downstream 401
    // gets wrapped as a 500 and we never trigger re-auth).
    const createSiteResponse = await fetchQuickCreate(normalizedPrompt, { authLevel: 3 }, { productId })

    if (createSiteResponse.status === 401) {
      logger.info('site-creation.auth-required', { source })
      onAuthRequired?.(normalizedPrompt)
      return
    }

    if (!createSiteResponse.ok) {
      const errorData = await createSiteResponse.json().catch(() => ({}))
      const errorMessage = errorData.message || errorData.error || 'Failed to create site'
      logger.error('site-creation.api-error', {
        status: createSiteResponse.status,
        error: errorMessage,
        source,
      })
      onError?.(errorMessage)
      return
    }

    const siteData: QuickCreateResponse = await createSiteResponse.json()
    logger.info('site-creation.success', {
      siteId: siteData.id,
      type: siteData.type,
      source,
    })

    setQuickCreateSessionFlags(siteData.id, normalizedPrompt, templateId)

    onSuccess?.(siteData.id, siteData.type)

    const redirectUrl = buildDevelopUrl(siteData.id, siteData.type)

    logger.info('site-creation.redirect', {
      siteId: siteData.id,
      idType: siteData.type,
      redirectUrl,
      source,
    })

    router.push(redirectUrl)

  } catch (error) {
    // User dismissed the SSO modal during authPreflight -- expected, not an error.
    if (error instanceof AuthDismissedError) {
      logger.info('site-creation.auth-dismissed', { source })
      return
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('site-creation.error', {
      error: errorMessage,
      source,
    })
    onError?.(errorMessage)
  }
}
