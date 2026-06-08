'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef } from 'react'
import Box from '@ux/box'
import Spinner from '@ux/spinner'

import { validateTemplate } from '@/app/[market]/components/types'
import { useSsoSignIn } from '@/hooks/useSsoSignIn'
import { ITC_QUERY_PARAM } from '@/lib/itc'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { createSiteAndRedirect } from '@/lib/site-creation'
import { useAuthUIStore } from '@/stores/useAuthUIStore'
import { resolveEntryPoint } from '@/utils/traffic-signals'

function CreatePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { signIn } = useSsoSignIn()
  const setRedirectUrl = useAuthUIStore((state) => state.setRedirectUrl)
  const ssoCloseReason = useAuthUIStore((state) => state.ssoCloseReason)
  const clearSsoCloseReason = useAuthUIStore((state) => state.clearSsoCloseReason)
  const hasInitialized = useRef(false)

  const initialPrompt = searchParams.get('initialPrompt')
  const rawTemplate = searchParams.get('template')
  const template = validateTemplate(rawTemplate) !== 'default' ? rawTemplate : null

  // Handle SSO modal dismiss - redirect to homepage with prompt
  useEffect(() => {
    if (ssoCloseReason === 'dismiss' && initialPrompt) {
      const trimmedPrompt = initialPrompt.trim()
      logger.info('create_page.auth_dismissed', {
        promptLength: trimmedPrompt.length,
      })
      shipAnalyticsLog('create_page.auth_dismissed', {
        promptLength: trimmedPrompt.length,
      })
      shipAnalyticsLog('create_page.redirect_to_homepage', {
        reason: 'auth_dismissed',
      })
      clearSsoCloseReason()
      router.replace(`/?initialPrompt=${encodeURIComponent(trimmedPrompt)}`)
    }
  }, [ssoCloseReason, initialPrompt, router, clearSsoCloseReason])

  useEffect(() => {
    // Prevent double execution in strict mode
    if (hasInitialized.current) return
    hasInitialized.current = true

    // Validate initialPrompt parameter
    if (!initialPrompt || !initialPrompt.trim()) {
      logger.info('create_page.missing_prompt', { hasParam: !!initialPrompt })
      shipAnalyticsLog('create_page.redirect_to_homepage', {
        reason: 'missing_prompt',
      })
      router.replace('/')
      return
    }

    const trimmedPrompt = initialPrompt.trim()

    // Log page load
    shipAnalyticsLog('create_page.loaded', {
      hasPrompt: true,
      promptLength: trimmedPrompt.length,
    })

    // Don't check auth upfront - just call the API
    // If the user is not authenticated, the API will return 401 and trigger SSO via onAuthRequired
    // This is more reliable than checking isAuthenticated upfront, which can be stale
    void createSiteAndRedirect(
      {
        prompt: trimmedPrompt,
        source: 'create-page',
        templateId: template || undefined,
        entryPoint: resolveEntryPoint(
          [searchParams.get('location'), searchParams.get(ITC_QUERY_PARAM), searchParams.get('site_location')],
          'create_route',
        ),
        onAuthRequired: (prompt) => {
          // API returned 401 - user not authenticated or token expired
          logger.info('create_page.auth_required', {
            promptLength: prompt.length,
          })
          shipAnalyticsLog('create_page.auth_required', {
            promptLength: prompt.length,
          })

          // Set redirect URL so SSO returns to this page after auth. Modal
          // path uses this via the store; redirect path consumes it from the
          // `redirectUrl` arg to signIn below. Preserve `itc` so attribution
          // survives even if localStorage is cleared during the SSO bounce.
          const params = new URLSearchParams({ initialPrompt: trimmedPrompt })
          if (template) params.set('template', template)
          const itc = searchParams.get(ITC_QUERY_PARAM)
          if (itc) params.set(ITC_QUERY_PARAM, itc)
          const redirectUrl = `/create?${params.toString()}`
          setRedirectUrl(redirectUrl)

          // Route through useSsoSignIn so the env gate decides modal vs
          // redirect. Mock auth is not reached here because this callback
          // only fires on a 401 from the server.
          signIn({ redirectUrl })
        },
        onError: (error) => {
          logger.error('create_page.create_failed', { error })
          // Redirect to homepage with prompt on error
          shipAnalyticsLog('create_page.redirect_to_homepage', {
            reason: 'create_failed',
          })
          router.replace(`/?initialPrompt=${encodeURIComponent(trimmedPrompt)}`)
        },
      },
      router
    )
  }, [initialPrompt, template, router, signIn, setRedirectUrl])

  // All states show the same UI: centered spinner
  return (
    <Box
      className="min-h-screen bg-gradient bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor"
      inlineAlignChildren="center"
      blockAlignChildren="center"
    >
      <Spinner data-partial="componentAiro" />
    </Box>
  )
}

export default function CreatePage() {
  return (
    <Suspense
      fallback={
        <Box
          className="min-h-screen bg-gradient bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor"
          inlineAlignChildren="center"
          blockAlignChildren="center"
        >
          <Spinner data-partial="componentAiro" />
        </Box>
      }
    >
      <CreatePageContent />
    </Suspense>
  )
}
