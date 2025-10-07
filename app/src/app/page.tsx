'use client'

import { useState, useCallback, useEffect, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Box from '@ux/box'
import Spinner from '@ux/spinner'
import { isFeatureEnabled } from '@/lib/features'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { useAuth } from '@/hooks/useAuth'
import BuiltWithSection from '@/app/components/BuiltWithSection'
import DiscoverSection from '@/app/components/DiscoverSection'
import ExpressSection from '@/app/components/ExpressSection'
import StartSection from '@/app/components/StartSection'
import InfraSection from '@/app/components/InfraSection'
import HelpSection from '@/app/components/HelpSection'
import TestimonialsSection from '@/app/components/TestimonialsSection'
import FeaturesSection from '@/components/layout/Features'
import { MockLoginDialog } from '@/components/auth/MockLogin'
import Header from '@/components/layout/Header'
import { logImpressionEvent } from '@/utils/instrumentation'
import HeroSection from './components/HeroSection'
import { HeroSectionRef } from './components/types'

function HomeContent() {
  const [promptText, setPromptText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMockLogin, setShowMockLogin] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const heroSectionRef = useRef<HeroSectionRef>(null)

  const { isAuthenticated, isAuthDisabled, gasketConfig } = useAuth(() => setShowMockLogin(true))

  useEffect(() => {
    logImpressionEvent({ eid: 'homepage.page' })();
  }, [])

  // Check for URL parameter and prefill prompt text
  useEffect(() => {
    const initialPromptParam = searchParams.get('initialPrompt')
    if (initialPromptParam && !promptText) {
      // URL decode and set the prompt text
      setPromptText(decodeURIComponent(initialPromptParam))
    }
  }, [searchParams, promptText])

  // Detect and handle back navigation to reset the redirect state
  useEffect(() => {
    // Reset the redirect state when returning to this page
    return () => setIsRedirecting(false)
  }, [])

  // Use useCallback to ensure the function reference stays stable
  const handleStartBuilding = useCallback(async () => {
    if (!promptText.trim() || isRedirecting || isLoading) return

    // Clear any previous errors and set loading state
    setError(null)
    setIsLoading(true)
    setIsRedirecting(true)

    try {
      // Step 1: Quick auth check - only redirect to login if needed
      // Ensure consistent timing for async and sync auth checks
      if (!isAuthDisabled && !isAuthenticated) {
        logger.info('page.auth.redirect', 'User not authenticated, redirecting to login')
        const isMockLoginEnabled = isFeatureEnabled.mockLogin();
        if (isMockLoginEnabled) {
          throw new Error('Please sign in using the mock authentication system')
        }
        if (gasketConfig) {
          const url = new URL(gasketConfig.sso.loginUrl);
          url.searchParams.set('app', 'airo-builder');
          url.searchParams.set('redirect', gasketConfig.redirects.loginRedirectUrl);
          window.location.href = url.toString();
        }
        return
      }

      // Step 2: Super fast create - only create database record, no deployment
      logger.info('page.site.quick-create.start', 'Quick creating site record')

      const createSiteResponse = await appFetch('/api/sites/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initialPrompt: promptText.trim()
        })
      })

      if (!createSiteResponse.ok) {
        const errorData = await createSiteResponse.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to create site')
      }

      const siteData = await createSiteResponse.json()
      logger.info('page.site.quick-create.success', { message: 'Site record created instantly', siteId: siteData.id, type: siteData.type })

      // Immediately redirect to /create/{siteId} - deployment will happen there
      // If the response includes type='job', add query param to indicate this is a temporary job ID
      // The create page will poll until it gets the real app ID
      const redirectUrl = siteData.type === 'job'
        ? `/create/${siteData.id}?type=job`
        : `/create/${siteData.id}`

      logger.info('page.site.redirect', {
        message: 'Redirecting to create page',
        siteId: siteData.id,
        idType: siteData.type,
        redirectUrl
      })

      router.push(redirectUrl)
    } catch (error) {
      console.error('❌ Error in start building flow:', error)

      // Set user-friendly error message
      let errorMessage = 'Something went wrong. Please try again.'

      if (error instanceof Error) {
        if (error.message.includes('Failed to create site')) {
          errorMessage = 'Failed to create your development environment. Please try again or contact support.'
        } else if (error.message.includes('Failed to validate account')) {
          errorMessage = 'Authentication failed. Please try logging in again.'
        } else if (error.message.includes('fetch')) {
          errorMessage = 'Unable to connect to the server. Please try again.'
        } else if (error.message.includes('Failed to fetch')) {
          errorMessage = 'Network error. Please check your connection and try again.'
        } else if (error.message.includes('TypeError')) {
          errorMessage = 'Connection error. Please ensure the backend service is running.'
        } else {
          errorMessage = error.message
        }
      }

      setError(errorMessage)

      // Reset flags on error
      setIsLoading(false)
      setIsRedirecting(false)
    }
  }, [promptText, router, isRedirecting, isLoading, isAuthenticated, isAuthDisabled, gasketConfig])

  const handleExampleClick = (examplePrompt: string) => {
    if (heroSectionRef.current) {
      heroSectionRef.current.typeText(examplePrompt)
    } else {
      // Fallback if ref is not available
      setPromptText(examplePrompt)
    }
  }

  return (
    <div className="relative w-full overflow-hidden header-bg bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor">
      <div className="footer-bg" />

      <div className="w-full h-full relative z-1">
        <Header
          className="absolute top-0 left-0 w-full border-0! z-20"
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
          onShowMockLogin={() => setShowMockLogin(true)}
          onExampleClick={handleExampleClick}
        />

        { /* <BuiltWithSection /> */ }

        <InfraSection />

        <FeaturesSection
          features={[
            {
              title: "Pro-grade hosting",
              description: "Global edge, fast caching, and sensible defaults for speed and reliability. Hit publish and serve worldwide without extra setup.",
            },
            {
              title: "Security by default",
              description: "Automatic SSL, DDoS protection, backups, and best-practice hardening—quietly working so you can focus on the build.",
            },
            {
              title: "Future-proof",
              description: "Keep control of your code and content, plug in the tools you love, and scale from “hello world” to high-traffic without switching stacks.",
            }
          ]}
        />

        <StartSection />

        <FeaturesSection
          features={[
            {
              title: "Idea to first draft",
              description: "Describe it and skip the blank canvas—Airo lays out pages, sections, and starter copy in seconds.",
            },
            {
              title: "Guided editing",
              description: "Tune layout, tone, and visuals with friendly controls. Code when you want, not when you have to.",
            },
            {
              title: "Publish and done",
              description: "One-click deploy on GoDaddy with SSL, forms, and analytics baked in. Export your code anytime.",
            }
          ]}
        />

        { /*
        <ExpressSection />

        <DiscoverSection />

        <TestimonialsSection />
        */ }

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
  )
}

export default function Home() {
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
      <HomeContent />
    </Suspense>
  )
}
