'use client'

import { useCallback, useState } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { validateAndClampPrompt } from '@/lib/waf-validation'
import { logAiroHQEvent } from '@/utils/instrumentation'

export interface QuickCreateResult {
  id: string
  type: 'job' | 'site'
  redirectUrl: string
}

export interface UseQuickCreateReturn {
  create: (prompt: string) => Promise<QuickCreateResult | null>
  isLoading: boolean
  error: string | null
  clearError: () => void
}

/**
 * Shared hook for quick-creating a site via the BFF.
 *
 * Handles prompt validation, the API call, and sessionStorage flags.
 * Does NOT handle auth checks (caller is responsible) or navigation
 * (returns redirectUrl for the caller to navigate).
 */
export function useQuickCreate(): UseQuickCreateReturn {
  const t = useTranslations()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = useCallback(async (rawPrompt: string): Promise<QuickCreateResult | null> => {
    const prompt = rawPrompt.replace(/https?:\/\/example\.com\s*/gi, '').trim()
    if (!prompt) return null

    const validated = validateAndClampPrompt(prompt)

    if (validated.wasClipped) {
      logger.warn('quick-create.prompt.clipped', {
        clippedLength: validated.charLength,
        byteLength: validated.byteLength,
      })
    }

    setError(null)
    setIsLoading(true)

    logAiroHQEvent({
      category: 'click',
      recommendation_task: 'builder_prompt_submit',
      recommendation_type: 'user_prompt',
    })()

    try {
      const response = await appFetch('/api/sites/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialPrompt: validated.text }),
      }, { setAuthState: false })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('AUTH_REQUIRED')
        }
        const errorData = await response.json().catch(() => ({}))
        const apiError = new Error(errorData.message || errorData.error || 'Failed to create site')
        if (errorData.details) {
          (apiError as any).details = errorData.details
        }
        throw apiError
      }

      const siteData = await response.json()
      logger.info('quick-create.success', { siteId: siteData.id, type: siteData.type })

      sessionStorage.setItem(`name-registration-pending-${siteData.id}`, 'true')
      sessionStorage.setItem(`initial-prompt-pending-${siteData.id}`, 'true')
      sessionStorage.setItem(`in-creation-flow-${siteData.id}`, 'true')
      sessionStorage.setItem(`initial-prompt-text-${siteData.id}`, validated.text)

      const redirectUrl = siteData.type === 'job'
        ? `/develop/${siteData.id}?type=job`
        : `/develop/${siteData.id}`

      logger.info('quick-create.redirect', {
        siteId: siteData.id,
        idType: siteData.type,
        redirectUrl,
      })

      return { id: siteData.id, type: siteData.type, redirectUrl }
    } catch (err) {
      logger.error('quick-create.failed', {
        error: err instanceof Error ? err.message : String(err),
        details: err instanceof Error ? (err as any).details : undefined,
      })

      if (err instanceof Error && err.message === 'AUTH_REQUIRED') {
        throw err
      }

      let errorMessage = 'Something went wrong. Please try again.'
      if (err instanceof Error) {
        if (err.message.includes('Failed to create site')) {
          errorMessage = t('builder_homepage_error_create')
        } else if (err.message.includes('Failed to validate account')) {
          errorMessage = t('builder_homepage_error_validate')
        } else if (err.message.includes('Failed to fetch')) {
          errorMessage = t('builder_homepage_error_network')
        } else if (err.message.includes('fetch')) {
          errorMessage = t('builder_homepage_error_fetch')
        } else if (err.message.includes('TypeError')) {
          errorMessage = t('builder_homepage_error_connection')
        } else {
          errorMessage = err.message
        }
      }

      setError(errorMessage)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [t])

  const clearError = useCallback(() => setError(null), [])

  return { create, isLoading, error, clearError }
}
