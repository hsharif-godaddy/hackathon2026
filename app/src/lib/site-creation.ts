import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { getByteLength, MAX_PROMPT_BYTES } from '@/lib/waf-validation'

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

interface CreateSiteResponse {
  id: string
  name?: string
  status: string
  account_id: string
  created_at: string
  updated_at: string
  type: 'job' | 'site'
}

/**
 * Creates a site via quick-create API and redirects to the develop page.
 * This centralizes the site creation flow used by homepage and /create page.
 */
export async function createSiteAndRedirect(
  options: CreateSiteOptions,
  router: Router
): Promise<void> {
  const { prompt, templateId, productId, source = 'unknown', onAuthRequired, onError, onSuccess } = options

  try {
    // Validate prompt
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

    // Call quick-create API
    const createSiteResponse = await appFetch('/api/sites/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initialPrompt: normalizedPrompt,
        productId,
      }),
    }, { setAuthState: false })

    // Handle 401 - auth required
    if (createSiteResponse.status === 401) {
      logger.info('site-creation.auth-required', { source })
      onAuthRequired?.(normalizedPrompt)
      return
    }

    // Handle other errors
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

    // Success
    const siteData: CreateSiteResponse = await createSiteResponse.json()
    logger.info('site-creation.success', {
      siteId: siteData.id,
      type: siteData.type,
      source,
    })

    // Set sessionStorage flags for develop page
    sessionStorage.setItem(`initial-prompt-pending-${siteData.id}`, 'true')
    sessionStorage.setItem(`initial-prompt-text-${siteData.id}`, normalizedPrompt)
    sessionStorage.setItem(`name-registration-pending-${siteData.id}`, 'true')
    sessionStorage.setItem(`in-creation-flow-${siteData.id}`, 'true')

    if (templateId && templateId !== 'default') {
      sessionStorage.setItem(`initial-template-${siteData.id}`, templateId)
    }

    onSuccess?.(siteData.id, siteData.type)

    // Redirect to develop page
    const redirectUrl = siteData.type === 'job'
      ? `/develop/${siteData.id}?type=job`
      : `/develop/${siteData.id}`

    logger.info('site-creation.redirect', {
      siteId: siteData.id,
      idType: siteData.type,
      redirectUrl,
      source,
    })

    router.push(redirectUrl)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('site-creation.error', {
      error: errorMessage,
      source,
    })
    onError?.(errorMessage)
  }
}
