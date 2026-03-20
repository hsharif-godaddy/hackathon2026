'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Box from '@ux/box'
import Spinner from '@ux/spinner'

import HelpSection from '@/app/components/HelpSection'
import HeroSection from '@/app/components/HeroSection'
import InfraSection from '@/app/components/InfraSection'
import StartSection from '@/app/components/StartSection'
import { HeroSectionRef } from '@/app/components/types'
import { UpgradeContainer } from '@/app/develop/components/paywall'
import { MockLoginDialog } from '@/components/auth/MockLogin'
import FAQSection from '@/components/layout/FAQSection'
import FeaturesSection from '@/components/layout/Features'
import Header from '@/components/layout/Header'
import PricingSection from '@/components/layout/PricingSection'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { useSafariClass } from '@/hooks/useSafariClass'
import { useSsoSignIn } from '@/hooks/useSsoSignIn'
import { useTranslations } from '@/hooks/useTranslations'
import { getErrorMessage } from '@/lib/errors'
import { isFeatureEnabled } from '@/lib/features'
import { appFetch } from '@/lib/gasket-config'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import type { ServerFeatureFlags } from '@/lib/server-features'
import { validateAndClampPrompt } from '@/lib/waf-validation'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation'

interface HomeContentProps {
  serverFeatures: ServerFeatureFlags
}

function HomeContentInner({ serverFeatures }: HomeContentProps) {
  const t = useTranslations();
  const [promptText, setPromptText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMockLogin, setShowMockLogin] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const heroSectionRef = useRef<HeroSectionRef>(null)
  const promptTextRef = useRef(promptText)
  // Ensure ref always mirrors latest prompt text without extra renders
  promptTextRef.current = promptText

  const { isAuthenticated, isAuthDisabled, isLoading: authIsLoading } = useAuthContext()
  const { signIn } = useSsoSignIn();
  const showUpgradeModal = useDevelopPageStore((state) => state.showUpgradeModal)
  const upgradeModalSource = useDevelopPageStore((state) => state.upgradeModalSource)
  const upgradeModalItc = useDevelopPageStore((state) => state.upgradeModalItc)
  const closeUpgradeModal = useDevelopPageStore((state) => state.closeUpgradeModal)

  useSafariClass()

  useEffect(() => {
    logImpressionEvent('homepage.page.view')();
    logAiroHQEvent({
      category: 'impression',
      recommendation_task: 'builder_homepage_viewed',
      recommendation_type: 'navigation'
    })();
  }, [])

  // Track the source of the redirect
  useEffect(() => {
    const siteLocation = searchParams.get('site_location') || document.referrer;
    if (siteLocation) {
      shipAnalyticsLog('homepage.redirect.source', { siteLocation });
    }
  }, []);

  // Check for URL parameter and prefill prompt text
  useEffect(() => {
    const initialPromptParam = searchParams.get('initialPrompt')
    if (initialPromptParam && !promptText) {
      // URL decode, validate, and set the prompt text
      const decoded = decodeURIComponent(initialPromptParam)
      const validated = validateAndClampPrompt(decoded)
      setPromptText(validated.text)

      if (validated.wasClipped) {
        logger.warn('homepage.url-param.clipped', {
          originalLength: decoded.length,
          clippedLength: validated.charLength,
          byteLength: validated.byteLength
        })
      }
    }
    // Intentionally excluding promptText from the dependency array to prevent clearing the input when typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    // Reset the redirect state when returning to this page
    return () => setIsRedirecting(false)
  }, [])

  // Helper function to save prompt to localStorage with error handling
  const savePromptForRetry = useCallback((prompt: string, context: 'login' | 'session-refresh') => {
    try {
      localStorage.setItem('airo-pending-prompt', prompt);
      logger.info('homepage.prompt.save', {
        context,
        promptLength: prompt.length
      });
    } catch (error) {
      logger.warn('homepage.prompt.save.error', {
        context,
        error: getErrorMessage(error)
      });
    }
  }, [])

  // Use useCallback to ensure the function reference stays stable
  const handleStartBuilding = useCallback(async (overridePrompt?: string) => {
    // Handle case where this is called as an event handler (overridePrompt would be a MouseEvent)
    let promptToUse = (typeof overridePrompt === 'string' ? overridePrompt : promptTextRef.current).trim()

    // Remove placeholder example URLs from the prompt
    promptToUse = promptToUse.replace(/https?:\/\/example\.com\s*/gi, '').trim()

    if (!promptToUse || isRedirecting || isLoading) return

    // Validate byte limit before sending (defense-in-depth on client)
    const validated = validateAndClampPrompt(promptToUse)
    promptToUse = validated.text

    if (validated.wasClipped) {
      logger.warn('homepage.submit.clipped', {
        originalLength: promptToUse.length,
        clippedLength: validated.charLength,
        byteLength: validated.byteLength
      })
    }

    // Short-circuit if auth state is still loading.
    // Wait for auth to resolve before deciding whether to show SSO login or proceed.
    // This prevents triggering SSO login during the brief window when auth is initializing.
    if (authIsLoading) {
      logger.debug('page.auth.loading', 'Auth state still loading, waiting before proceeding')
      return
    }

    // Clear any previous errors and set loading state
    setError(null)
    setIsLoading(true)
    setIsRedirecting(true)

    logAiroHQEvent({
      category: 'click',
      recommendation_task: 'builder_homepage_prompt_submit',
      recommendation_type: 'user_prompt'
    })();

    try {
      // Step 1: Quick auth check - show in-app SSO login if needed
      // Auth state is now definitively resolved (authIsLoading is false)
      if (!isAuthDisabled && !isAuthenticated) {
        logger.info('page.auth.sso-login', {
          action: 'showing-sso-login'
        });

        // Save the prompt to localStorage before showing login
        savePromptForRetry(promptToUse, 'login');

        signIn({ onShowMockLogin: () => setShowMockLogin(true) });
        setIsLoading(false);
        setIsRedirecting(false);
        return;
      }

      // Step 2: Super fast create - only create database record, no deployment
      const createSiteResponse = await appFetch('/api/sites/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initialPrompt: promptToUse
        })
      }, { setAuthState: false })

      if (!createSiteResponse.ok) {
        // 401 means unauthenticated — trigger SSO login to refresh the session
        if (createSiteResponse.status === 401) {
          logger.info('homepage.auth-required', {
            action: 'triggering-sso-login',
            phase: 'quick-create'
          });

          // Save the prompt to localStorage before showing login
          savePromptForRetry(promptToUse, 'session-refresh');

          signIn({ onShowMockLogin: () => setShowMockLogin(true) });
          setIsLoading(false);
          setIsRedirecting(false);
          return;
        }

        // For other errors, extract and throw
        const errorData = await createSiteResponse.json().catch(() => ({}))
        const apiError = new Error(errorData.message || errorData.error || 'Failed to create site')
        if (errorData.details) {
          (apiError as any).details = errorData.details
        }
        throw apiError
      }

      const siteData = await createSiteResponse.json()
      logger.info('page.site.quick-create.success', { message: 'Site record created instantly', siteId: siteData.id, type: siteData.type })

      // Set flags for post-setup actions before redirect
      sessionStorage.setItem(`name-registration-pending-${siteData.id}`, 'true')
      sessionStorage.setItem(`initial-prompt-pending-${siteData.id}`, 'true')
      sessionStorage.setItem(`in-creation-flow-${siteData.id}`, 'true')
      sessionStorage.setItem(`initial-prompt-text-${siteData.id}`, promptToUse)

      // Immediately redirect to /develop/{siteId} - deployment polling will happen there
      // If the response includes type='job', add query param to indicate this is a temporary job ID
      // The develop page will poll until it gets the real app ID
      const redirectUrl = siteData.type === 'job'
        ? `/develop/${siteData.id}?type=job`
        : `/develop/${siteData.id}`

      logger.info('page.site.redirect', {
        message: 'Redirecting to develop page',
        siteId: siteData.id,
        idType: siteData.type,
        redirectUrl
      })

      router.push(redirectUrl)
    } catch (error) {
      logger.error('homepage.start_building.failed', {
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof Error ? (error as any).details : undefined
      })

      // Set user-friendly error message
      let errorMessage = 'Something went wrong. Please try again.'

      if (error instanceof Error) {
        if (error.message.includes('Failed to create site')) {
          errorMessage = t('builder_homepage_error_create')
        } else if (error.message.includes('Failed to validate account')) {
          errorMessage = t('builder_homepage_error_validate')
        } else if (error.message.includes('fetch')) {
          errorMessage = t('builder_homepage_error_fetch')
        } else if (error.message.includes('Failed to fetch')) {
          errorMessage = t('builder_homepage_error_network')
        } else if (error.message.includes('TypeError')) {
          errorMessage = t('builder_homepage_error_connection')
        } else {
          errorMessage = error.message
        }
      }

      setError(errorMessage)

      // Reset flags on error
      setIsLoading(false)
      setIsRedirecting(false)
    }
  }, [router, isRedirecting, isLoading, isAuthenticated, isAuthDisabled, authIsLoading, signIn, savePromptForRetry, t])

  // Restore prompt from localStorage after login and clear it
  useEffect(() => {
    if (!isAuthenticated || authIsLoading) return

    const savedPrompt = localStorage.getItem('airo-pending-prompt')

    if (savedPrompt && !promptText) {
      logger.info('homepage.prompt.restore', { message: 'Restoring saved prompt after login' })

      // Validate before restoring
      const validated = validateAndClampPrompt(savedPrompt)
      setPromptText(validated.text)
      localStorage.removeItem('airo-pending-prompt')

      if (validated.wasClipped) {
        logger.warn('homepage.restore.clipped', {
          originalLength: savedPrompt.length,
          clippedLength: validated.charLength,
          byteLength: validated.byteLength
        })
      }

      handleStartBuilding(validated.text)
    }
  }, [isAuthenticated, authIsLoading, promptText, handleStartBuilding])

  const handleExampleClick = (examplePrompt: string) => {
    if (heroSectionRef.current) {
      // typeText already validates inside HeroSection
      heroSectionRef.current.typeText(examplePrompt)
    } else {
      // Fallback if ref is not available - validate before setting
      const validated = validateAndClampPrompt(examplePrompt)
      setPromptText(validated.text)

      if (validated.wasClipped) {
        logger.warn('homepage.example.clipped', {
          originalLength: examplePrompt.length,
          clippedLength: validated.charLength,
          byteLength: validated.byteLength
        })
      }
    }
  }

  return (
    <>
      <div className="isolate relative w-full overflow-hidden bg-gradient bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor">
        <div className="w-full h-full relative">
          <Header
            className="absolute top-0 left-0 w-full border-0!"
            onShowMockLogin={() => setShowMockLogin(true)}
            location='homepage'
          />

          <HeroSection
            ref={heroSectionRef}
            promptText={promptText}
            setPromptText={setPromptText}
            onStartBuilding={handleStartBuilding}
            isLoading={isLoading}
            error={error}
            setError={setError}
            onExampleClick={handleExampleClick}
          />

          <InfraSection />

          <FeaturesSection
            features={[
              {
                title: t('builder_homepage_feature_prograde_title'),
                description: t('builder_homepage_feature_prograde_description'),
              },
              {
                title: t('builder_homepage_feature_security_title'),
                description: t('builder_homepage_feature_security_description'),
              },
              {
                title: t('builder_homepage_feature_future_title'),
                description: t('builder_homepage_feature_future_description'),
              }
            ]}
          />

          <StartSection />

          <FeaturesSection
            features={[
              {
                title: t('builder_homepage_feature_idea_title'),
                description: t('builder_homepage_feature_idea_description'),
              },
              {
                title: t('builder_homepage_feature_editing_title'),
                description: t('builder_homepage_feature_editing_description'),
              },
              {
                title: t('builder_homepage_feature_publish_title'),
                description: t('builder_homepage_feature_publish_description'),
              }
            ]}
          />

          {serverFeatures.showPricingSection && <PricingSection showHighTierPlans={serverFeatures.showHighTierPlans} />}

          <FAQSection />

          <HelpSection />

          {/* Mock Login Modal - available throughout the entire page */}
          {isFeatureEnabled.mockLogin() && (
            <MockLoginDialog
              isOpen={showMockLogin}
              onClose={() => setShowMockLogin(false)}
            />
          )}

        </div>
      </div>

      {showUpgradeModal && (
        <UpgradeContainer
          source={upgradeModalSource ?? 'unknown'}
          itc={upgradeModalItc ?? undefined}
          onSuccessClick={() => {
            closeUpgradeModal()
          }}
          onClose={() => {
            const source = upgradeModalSource ?? 'unknown'
            closeUpgradeModal()
            shipAnalyticsLog(`${source}.dismissed`, {})
          }}
          onErrorClick={() => {
            const source = upgradeModalSource ?? 'unknown'
            closeUpgradeModal()
            shipAnalyticsLog(`${source}.error`, {})
          }}
        />
      )}
    </>
  )
}

export default function HomeContent({ serverFeatures }: HomeContentProps) {
  return (
    <Suspense fallback={
      <Box
        className="min-h-screen"
        inlineAlignChildren='center'
        blockAlignChildren='center'
      >
        <Spinner />
      </Box>
    }>
      <HomeContentInner serverFeatures={serverFeatures} />
    </Suspense>
  )
}
