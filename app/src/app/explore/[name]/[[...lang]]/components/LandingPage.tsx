'use client'

import { useRouter } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Box from '@ux/box'
import Spinner from '@ux/spinner'

import { MockLoginDialog } from '@/components/auth/MockLogin'
import ExploreFooter from '@/components/layout/ExploreFooter'
import Header from '@/components/layout/Header'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { useSafariClass } from '@/hooks/useSafariClass'
import { useSsoSignIn } from '@/hooks/useSsoSignIn'
import { useTranslations } from '@/hooks/useTranslations'
import { getErrorMessage } from '@/lib/errors'
import { isFeatureEnabled } from '@/lib/features'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation'
import LandingHero from './LandingHero'
import SectionRenderer from './SectionRenderer'
import { LandingPageData } from './types'

interface LandingHeroRef {
  typeText: (text: string) => void
}

interface LandingPageProps {
  data: LandingPageData
}

function LandingPageContent({ data }: LandingPageProps) {
  const t = useTranslations();
  const [promptText, setPromptText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMockLogin, setShowMockLogin] = useState(false)
  const router = useRouter()
  const heroRef = useRef<LandingHeroRef>(null)
  const promptTextRef = useRef(promptText)
  promptTextRef.current = promptText

  const { isAuthenticated, isAuthDisabled, isLoading: authIsLoading } = useAuthContext()
  const { signIn } = useSsoSignIn()

  useSafariClass()

  const slug = data.route.useCase

  useEffect(() => {
    logImpressionEvent(`landing-${slug}.page.view`)();
    logAiroHQEvent({
      category: 'impression',
      recommendation_task: `builder_landing_${slug}_viewed`,
      recommendation_type: 'navigation'
    })();
  }, [slug])

  useEffect(() => {
    return () => setIsRedirecting(false)
  }, [])

  const savePromptForRetry = useCallback((prompt: string, context: 'login' | 'session-refresh') => {
    try {
      localStorage.setItem('airo-pending-prompt', prompt);
      logger.info('landing.prompt.save', {
        context,
        slug,
        promptLength: prompt.length
      });
    } catch (err) {
      logger.warn('landing.prompt.save.error', {
        context,
        error: getErrorMessage(err)
      });
    }
  }, [slug])

  const handleStartBuilding = useCallback(async (overridePrompt?: string) => {
    let promptToUse = (typeof overridePrompt === 'string' ? overridePrompt : promptTextRef.current).trim()
    promptToUse = promptToUse.replace(/https?:\/\/example\.com\s*/gi, '').trim()

    if (!promptToUse || isRedirecting || isLoading) return
    if (authIsLoading) {
      logger.debug('landing.auth.loading', 'Auth state still loading, waiting before proceeding')
      return
    }

    setError(null)
    setIsLoading(true)
    setIsRedirecting(true)

    logAiroHQEvent({
      category: 'click',
      recommendation_task: `builder_landing_${slug}_prompt_submit`,
      recommendation_type: 'user_prompt'
    })();

    try {
      if (!isAuthDisabled && !isAuthenticated) {
        logger.info('landing.auth.sso-login', { action: 'showing-sso-login' });
        savePromptForRetry(promptToUse, 'login');
        signIn({ onShowMockLogin: () => setShowMockLogin(true) });
        setIsLoading(false);
        setIsRedirecting(false);
        return;
      }

      const createSiteResponse = await appFetch('/api/sites/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialPrompt: promptToUse })
      })

      if (!createSiteResponse.ok) {
        if (createSiteResponse.status === 401 && createSiteResponse.requiresRefresh) {
          logger.info('landing.session-stale', {
            action: 'triggering-sso-login',
            phase: 'quick-create'
          });
          savePromptForRetry(promptToUse, 'session-refresh');
          signIn({ onShowMockLogin: () => setShowMockLogin(true) });
          setIsLoading(false);
          setIsRedirecting(false);
          return;
        }
        const errorData = await createSiteResponse.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || 'Failed to create site')
      }

      const siteData = await createSiteResponse.json()
      logger.info('landing.site.quick-create.success', {
        siteId: siteData.id,
        type: siteData.type,
        landingSlug: slug
      })

      sessionStorage.setItem(`name-registration-pending-${siteData.id}`, 'true')
      sessionStorage.setItem(`initial-prompt-pending-${siteData.id}`, 'true')
      sessionStorage.setItem(`in-creation-flow-${siteData.id}`, 'true')
      sessionStorage.setItem(`initial-prompt-text-${siteData.id}`, promptToUse)

      router.push(
        siteData.type === 'job'
          ? `/develop/${siteData.id}?type=job`
          : `/develop/${siteData.id}`
      )
    } catch (err) {
      logger.error('landing.start_building.failed', {
        error: err instanceof Error ? err.message : String(err),
        landingSlug: slug
      })

      let errorMessage = 'Something went wrong. Please try again.'
      if (err instanceof Error) {
        if (err.message.includes('Failed to create site')) {
          errorMessage = t('builder_homepage_error_create')
        } else if (err.message.includes('Failed to validate account')) {
          errorMessage = t('builder_homepage_error_validate')
        } else if (err.message.includes('fetch') || err.message.includes('Failed to fetch')) {
          errorMessage = t('builder_homepage_error_network')
        } else if (err.message.includes('TypeError')) {
          errorMessage = t('builder_homepage_error_connection')
        } else {
          errorMessage = err.message
        }
      }

      setError(errorMessage)
      setIsLoading(false)
      setIsRedirecting(false)
    }
  }, [router, isRedirecting, isLoading, isAuthenticated, isAuthDisabled, authIsLoading, signIn, savePromptForRetry, t, slug])

  useEffect(function restorePromptAfterLogin() {
    if (!isAuthenticated || authIsLoading) return
    const savedPrompt = localStorage.getItem('airo-pending-prompt')
    if (savedPrompt && !promptText) {
      logger.info('landing.prompt.restore', { message: 'Restoring saved prompt after login' })
      setPromptText(savedPrompt)
      localStorage.removeItem('airo-pending-prompt')
      handleStartBuilding(savedPrompt)
    }
  }, [isAuthenticated, authIsLoading, promptText, handleStartBuilding])

  const handleExampleClick = (examplePrompt: string) => {
    if (heroRef.current) {
      heroRef.current.typeText(examplePrompt)
    } else {
      setPromptText(examplePrompt)
    }
  }

  const themeStyle: React.CSSProperties = {}
  const theme = data.theme
  if (theme?.backgroundGradient && theme.backgroundGradient !== 'default') {
    themeStyle.background = theme.backgroundGradient
  }
  if (theme?.glowColors?.length === 5) {
    theme.glowColors.forEach((color, i) => {
      (themeStyle as Record<string, string>)[`--landing-glow-${i + 1}`] = color
    })
  }
  if (theme?.featureColors?.length === 3) {
    theme.featureColors.forEach((color, i) => {
      (themeStyle as Record<string, string>)[`--landing-feature-${i + 1}`] = color
    })
  }
  if (theme?.accentColor) {
    (themeStyle as Record<string, string>)['--landing-accent'] = theme.accentColor
  }

  return (
    <div
      className="relative w-full overflow-hidden bg-gradient bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor"
      style={themeStyle}
    >
      <div className="w-full h-full relative z-10">
        <Header
          className="absolute top-0 left-0 w-full !border-0 z-20"
          onShowMockLogin={() => setShowMockLogin(true)}
          location={data.header.location}
        />

        <LandingHero
          ref={heroRef}
          hero={data.hero}
          promptText={promptText}
          setPromptText={setPromptText}
          onStartBuilding={handleStartBuilding}
          isLoading={isLoading}
          error={error}
          setError={setError}
          onExampleClick={handleExampleClick}
          slug={slug}
        />

        <SectionRenderer sections={data.sections} />

        <ExploreFooter />

        {isFeatureEnabled.mockLogin() && (
          <MockLoginDialog
            isOpen={showMockLogin}
            onClose={() => setShowMockLogin(false)}
          />
        )}
      </div>
    </div>
  )
}

export default function LandingPage(props: LandingPageProps) {
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
      <LandingPageContent {...props} />
    </Suspense>
  )
}
