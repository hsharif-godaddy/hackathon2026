'use client'

import clsx from 'clsx'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import HelpSection from '@/app/[market]/components/HelpSection'
import HeroSection from '@/app/[market]/components/HeroSection'
import InfraSection from '@/app/[market]/components/InfraSection'
import StartSection from '@/app/[market]/components/StartSection'
import { HeroSectionRef, LOGO_DESIGNER_TEMPLATE, validateTemplate } from '@/app/[market]/components/types'
import { UpgradeContainer } from '@/app/[market]/develop/components/paywall'
import { MockLoginDialog } from '@/components/auth/MockLogin'
import FAQSection from '@/components/layout/FAQSection'
import FeaturesSection from '@/components/layout/Features'
import Header from '@/components/layout/Header'
import PricingSection from '@/components/layout/PricingSection'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useAuthGateTracking } from '@/hooks/useAuthGateTracking'
import { useHomepageBounceTracking } from '@/hooks/useHomepageBounceTracking'
import { useSafariClass } from '@/hooks/useSafariClass'
import { useSsoSignIn } from '@/hooks/useSsoSignIn'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { getErrorMessage } from '@/lib/errors'
import { isFeatureEnabled } from '@/lib/features'
import { shipAnalyticsLog } from '@/lib/logging'
import { buildDevelopUrl, extractApiError, fetchQuickCreate, type QuickCreateResponse, setQuickCreateSessionFlags } from '@/lib/quick-create'
import { logger } from '@/lib/request-context'
import type { ServerFeatureFlags } from '@/lib/server-features'
import { validateAndClampPrompt } from '@/lib/waf-validation'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation'

interface HomeContentProps {
  serverFeatures: ServerFeatureFlags
}

type SubmitSource = 'example' | 'text'

export function OriginalHomePage({ serverFeatures }: HomeContentProps) {
  const t = useTranslations();
  const [promptText, setPromptText] = useState("")
  const router = useRouter()
  const searchParams = useSearchParams()
  const templateParam = searchParams.get('template')
  const [selectedTemplate, setSelectedTemplate] = useState(validateTemplate(templateParam))
  const isLogoMode = templateParam === LOGO_DESIGNER_TEMPLATE
  const { data: isTemplateSelectorEnabled } = useSwitchboard('appbuilder-template-selector')
  const [isLoading, setIsLoading] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMockLogin, setShowMockLogin] = useState(false)
  const heroSectionRef = useRef<HeroSectionRef>(null)
  const homepageViewRecordedRef = useRef(false)
  const scrollMilestonesLoggedRef = useRef<Set<number>>(new Set())
  const authGateShownAtRef = useRef<number | null>(null)
  const homepageSubmitAttemptRef = useRef(0)
  const pendingHomepageErrorRef = useRef<{
    attemptNumber: number
    errorType: string
    occurredAt: number
  } | null>(null)
  const promptTextRef = useRef(promptText)
  const submitSourceRef = useRef<SubmitSource>('text')
  // Ensure ref always mirrors latest prompt text without extra renders
  promptTextRef.current = promptText

  const { isAuthenticated, isLoading: authIsLoading } = useAuthContext()
  const { cohort, logAnalytics } = useAnalytics({
    experimentId: EXPERIMENT_IDS.homepageEngagement,
    baseData: { isAuthenticated },
  })
  const { signIn } = useSsoSignIn()
  const showUpgradeModal = useDevelopPageStore((state) => state.showUpgradeModal)
  const upgradeModalSource = useDevelopPageStore((state) => state.upgradeModalSource)
  const upgradeModalItc = useDevelopPageStore((state) => state.upgradeModalItc)
  const closeUpgradeModal = useDevelopPageStore((state) => state.closeUpgradeModal)

  const setHeroError = useCallback((next: string | null) => {
    if (next === null && pendingHomepageErrorRef.current) {
      logAnalytics('homepage.error.abandon', {
        attemptNumber: pendingHomepageErrorRef.current.attemptNumber,
        errorType: pendingHomepageErrorRef.current.errorType,
        msFromError: Math.round(Date.now() - pendingHomepageErrorRef.current.occurredAt),
      })
      pendingHomepageErrorRef.current = null
    }
    setError(next)
  }, [logAnalytics])

  const logHomepagePricingView = useCallback(
    ({ viewDurationMs }: { viewDurationMs: number }) => {
      const promptState = promptText.trim().length > 0 ? 'has_content' : 'empty'
      const msFromPageLoad = Math.round(performance.now())
      logAnalytics(
        'homepage.pricing.view',
        {
          msFromPageLoad,
          promptState,
          viewDurationMs,
        },
        {
          kind: 'impression',
          eid: 'homepage.pricing.view',
          impressionProps: {
            promptState,
            viewDurationMs,
          },
        },
      )
    },
    [logAnalytics, promptText],
  )

  useSafariClass()
  useAuthGateTracking(logAnalytics, { authGateShownAtRef, promptTextRef })
  const { markEngaged: markHomepageEngaged } = useHomepageBounceTracking(logAnalytics)

  useEffect(() => {
    if (authIsLoading || homepageViewRecordedRef.current) {
      return
    }
    homepageViewRecordedRef.current = true
    logAnalytics('homepage.view')
    logImpressionEvent('homepage.page.view', { cohort })();
    logAiroHQEvent({
      category: 'impression',
      recommendation_task: 'builder_homepage_viewed',
      recommendation_type: 'navigation'
    })();
  }, [authIsLoading, cohort, logAnalytics])

  useEffect(() => {
    function updateScrollMilestones() {
      if (scrollMilestonesLoggedRef.current.size === 4) return

      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      const promptHasContent = promptTextRef.current.trim().length > 0
      const msFromPageLoad = Math.round(performance.now())

      if (scrollable <= 0) {
        if (!scrollMilestonesLoggedRef.current.has(100)) {
          scrollMilestonesLoggedRef.current.add(25)
          scrollMilestonesLoggedRef.current.add(50)
          scrollMilestonesLoggedRef.current.add(75)
          scrollMilestonesLoggedRef.current.add(100)
          logAnalytics(
            'homepage.scroll.milestone',
            {
              depth: 100,
              msFromPageLoad,
              promptHasContent,
            },
            {
              kind: 'action',
              eid: 'homepage.depth.complete',
              action: 'scroll',
            },
          )
        }
        return
      }

      const percent = (window.scrollY / scrollable) * 100
      for (const depth of [25, 50, 75, 100] as const) {
        if (percent >= depth && !scrollMilestonesLoggedRef.current.has(depth)) {
          scrollMilestonesLoggedRef.current.add(depth)
          const options =
            depth === 25
              ? {
                  kind: 'action' as const,
                  eid: 'homepage.depth.start',
                  action: 'scroll' as const,
                }
              : depth === 100
                ? {
                    kind: 'action' as const,
                    eid: 'homepage.depth.complete',
                    action: 'scroll' as const,
                  }
                : undefined

          logAnalytics('homepage.scroll.milestone', { depth, msFromPageLoad, promptHasContent }, options)
        }
      }
    }

    window.addEventListener('scroll', updateScrollMilestones, { passive: true })
    updateScrollMilestones()
    return () => window.removeEventListener('scroll', updateScrollMilestones)
  }, [logAnalytics])

  // Track the source of the redirect
  useEffect(() => {
    const siteLocation = searchParams.get('site_location') || document.referrer;
    if (siteLocation) {
      shipAnalyticsLog('homepage.redirect.source', { siteLocation });
    }
  }, [searchParams]);

  // Check for URL parameter and prefill prompt text
  useEffect(() => {
    const initialPromptParam = searchParams.get('initialPrompt')
    if (initialPromptParam && !promptText) {
      const decoded = decodeURIComponent(initialPromptParam)
      const validated = validateAndClampPrompt(decoded)
      setPromptText(validated.text)

      logAnalytics('homepage.prompt.prefill_from_url', {
        clipped: validated.wasClipped,
        promptLength: validated.text.length,
      })

      if (validated.wasClipped) {
        logger.warn('homepage.url-param.clipped', {
          originalLength: decoded.length,
          clippedLength: validated.charLength,
          byteLength: validated.byteLength
        })
      }
    }
    // Intentionally excluding promptText from the dependency array to prevent clearing the input when typing.

  }, [logAnalytics, searchParams])

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

    // Submit attempt counts as engagement even when invoked programmatically
    // (e.g. auto-resubmit after SSO round-trip). Idempotent with DOM click.
    markHomepageEngaged()

    const preClampPromptLength = promptToUse.length
    const validated = validateAndClampPrompt(promptToUse)
    promptToUse = validated.text

    if (validated.wasClipped) {
      logger.warn('homepage.submit.clipped', {
        originalLength: preClampPromptLength,
        clippedLength: validated.charLength,
        byteLength: validated.byteLength
      })
    }
    const submitSource = submitSourceRef.current
    const firstInputTime = heroSectionRef.current?.getFirstInputTime()

    // Short-circuit if auth state is still loading.
    // Wait for auth to resolve before deciding whether to show SSO login or proceed.
    // This prevents triggering SSO login during the brief window when auth is initializing.
    if (authIsLoading) {
      logger.debug('page.auth.loading', 'Auth state still loading, waiting before proceeding')
      return
    }

    logAnalytics('homepage.prompt.submit_attempt', {
      submitSource,
      promptLength: promptToUse.length,
      msFromPageLoad: Math.round(performance.now()),
      ...(firstInputTime && { msFromFirstInput: Date.now() - firstInputTime }),
    })

    homepageSubmitAttemptRef.current += 1
    const submitAttemptNumber = homepageSubmitAttemptRef.current
    if (pendingHomepageErrorRef.current) {
      logAnalytics('homepage.error.retry', {
        attemptNumber: submitAttemptNumber,
        errorType: pendingHomepageErrorRef.current.errorType,
        msFromError: Math.round(Date.now() - pendingHomepageErrorRef.current.occurredAt),
      })
      pendingHomepageErrorRef.current = null
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
      if (!isAuthenticated) {
        logger.info('page.auth.sso-login', {
          action: 'showing-sso-login'
        });

        // Save the prompt to localStorage before showing login
        savePromptForRetry(promptToUse, 'login');

        logAnalytics(
          'homepage.auth_gate.shown',
          {
            submitSource,
          },
          {
            kind: 'action',
            eid: 'homepage.auth.gate',
            action: 'load',
          },
        )
        authGateShownAtRef.current = Date.now()
        signIn({ onShowMockLogin: () => setShowMockLogin(true) });
        setIsLoading(false);
        setIsRedirecting(false);
        return;
      }

      const createSiteResponse = await fetchQuickCreate(promptToUse)

      if (!createSiteResponse.ok) {
        if (createSiteResponse.status === 401) {
          logger.info('homepage.auth-required', {
            action: 'triggering-sso-login',
            phase: 'quick-create'
          });

          savePromptForRetry(promptToUse, 'session-refresh');

          logAnalytics(
            'homepage.auth_gate.shown',
            {
              submitSource,
            },
            {
              kind: 'action',
              eid: 'homepage.auth.gate',
              action: 'load',
            },
          )
          authGateShownAtRef.current = Date.now()
          signIn({ onShowMockLogin: () => setShowMockLogin(true) });
          setIsLoading(false);
          setIsRedirecting(false);
          return;
        }

        const errorData = await createSiteResponse.json().catch(() => ({}))
        throw extractApiError(errorData)
      }

      const siteData: QuickCreateResponse = await createSiteResponse.json()
      logger.info('page.site.quick-create.success', { message: 'Site record created instantly', siteId: siteData.id, type: siteData.type })

      setQuickCreateSessionFlags(siteData.id, promptToUse, selectedTemplate)

      const redirectUrl = buildDevelopUrl(siteData.id, siteData.type)

      logger.info('page.site.redirect', {
        message: 'Redirecting to develop page',
        siteId: siteData.id,
        idType: siteData.type,
        redirectUrl
      })
      logAnalytics(
        'homepage.redirect.develop',
        { submitSource },
        {
          kind: 'impression',
          eid: 'homepage.redirect.develop',
        },
      )

      pendingHomepageErrorRef.current = null
      router.push(redirectUrl)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('homepage.start_building.failed', {
        error: errorMsg,
        details: error instanceof Error ? (error as any).details : undefined
      })
      logAnalytics('homepage.submit.error', {
        submitSource,
        errorMessage: errorMsg.substring(0, 200),
      })

      let errorMessage = t('builder_abstract_animation_error_generic')
      let errorType = 'generic'

      if (error instanceof Error) {
        if (error.message.includes('Failed to create site')) {
          errorType = 'create_failed'
          errorMessage = t('builder_homepage_error_create')
        } else if (error.message.includes('Failed to validate account')) {
          errorType = 'validate_failed'
          errorMessage = t('builder_homepage_error_validate')
        } else if (error.message.includes('Failed to fetch')) {
          errorType = 'network'
          errorMessage = t('builder_homepage_error_network')
        } else if (error.message.includes('fetch')) {
          errorType = 'network'
          errorMessage = t('builder_homepage_error_fetch')
        } else if (error.message.includes('TypeError')) {
          errorType = 'connection'
          errorMessage = t('builder_homepage_error_connection')
        } else {
          errorMessage = error.message
        }
      }

      pendingHomepageErrorRef.current = {
        attemptNumber: homepageSubmitAttemptRef.current,
        errorType,
        occurredAt: Date.now(),
      }
      setError(errorMessage)

      // Reset flags on error
      setIsLoading(false)
      setIsRedirecting(false)
    }
  }, [authIsLoading, isAuthenticated, isLoading, isRedirecting, logAnalytics, markHomepageEngaged, router, savePromptForRetry, selectedTemplate, signIn, t])

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
      logAnalytics('homepage.auth_prompt.restored')

      if (validated.wasClipped) {
        logger.warn('homepage.restore.clipped', {
          originalLength: savedPrompt.length,
          clippedLength: validated.charLength,
          byteLength: validated.byteLength
        })
      }

      handleStartBuilding(validated.text)
    }
  }, [authIsLoading, handleStartBuilding, isAuthenticated, logAnalytics, promptText])

  const handleExampleClick = (examplePrompt: string) => {
    submitSourceRef.current = 'example'
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
      <div
        className={clsx(
          'isolate relative w-full overflow-hidden',
          'bg-gradient bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor',
        )}
        data-homepage-variation="original"
      >
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
            setError={setHeroError}
            onExampleClick={handleExampleClick}
            {...(isLogoMode && {
              headingText: t('builder_homepage_experiment_logo_header', undefined, 'Design a logo that defines your brand'),
              subheadingText: t('builder_homepage_experiment_logo_subheader', undefined, 'Describe your style and our AI will craft a unique logo in minutes'),
            })}
            {...(isTemplateSelectorEnabled && {
              selectedTemplate,
              onTemplateChange: setSelectedTemplate,
            })}
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

          {serverFeatures.showPricingSection && <PricingSection onPricingViewEnd={logHomepagePricingView} />}

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

