'use client'

import { useState, useCallback, useEffect, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthState, AuthRealmType, AuthRiskType, AuthIdpType } from '@godaddy/gasket-auth'
import { appFetch } from '@/lib/gasket-config'
import { authConfigs, getLoginUrl, isAuthDisabled } from '@/lib/gasket-config'
import { useIntegratedAuthState } from '@/lib/mock-auth-integration'
import { isFeatureEnabled } from '@/lib/features'
import { logger } from '@/lib/request-context'
import Header from '@/components/layout/Header'
import HeroSection from './components/HeroSection'
import ExamplesSection from './components/ExamplesSection'
import BuiltWithSection from './components/BuiltWithSection'
import Footer from './components/Footer'
import { Example, BuiltWithItem, HeroSectionRef } from './components/types'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'

function HomeContent() {
  const [promptText, setPromptText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const heroSectionRef = useRef<HeroSectionRef>(null)

  // Get auth state - allow gasket to handle refresh but control redirects
  const originalAuthState = useAuthState({
    realm: authConfigs.user.realm as AuthRealmType,
    risk: authConfigs.user.risk as AuthRiskType,
    type: authConfigs.user.type as AuthIdpType[],
    allowHeartbeat: authConfigs.user.allowHeartbeat,
    use12HourExpiration: authConfigs.user.use12HourExpiration,
    // Remove alt to allow proper token refresh, handle redirects in our logic instead
  })

  // Use integrated auth state that considers mock auth
  const authState = useIntegratedAuthState(originalAuthState)

  // Track if user is redirecting to prevent multiple calls
  const [isRedirecting, setIsRedirecting] = useState(false)

  const examples: Example[] = [
    {
      title: "Fitness Studio Website",
      prompt: "I need a modern website for my local fitness studio. We offer personal training, group classes, and nutrition coaching. I want members to be able to book classes online, view schedules, and access workout plans."
    },
    {
      title: "Local Food Truck Landing Page",
      prompt: "Create a landing page for a food truck. I need to showcase our menu, display our hours and show a map with our current location."
    },
    {
      title: "Freelancer Portfolio Site",
      prompt: "Build a professional portfolio website for my graphic design services. I need a homepage, portfolio gallery, about page, services overview, and contact form. Make it clean and modern to showcase my work."
    },
    {
      title: "Small Business Directory",
      prompt: "Create a simple directory website for local businesses in my town. Users should be able to browse by category, search businesses, view business profiles with contact info, and submit new business listings."
    }
  ]

  const builtWithItems: BuiltWithItem[] = [
    {
      id: "1",
      title: "FitFlow Studio",
      description: "Modern fitness studio website with online class booking, member portal, and trainer profiles. Built with React and integrated payment processing.",
      thumbnailPath: "/placeholder-fitness.jpg",
      category: "Health & Fitness"
    },
    {
      id: "2",
      title: "TastyWheels Food Truck",
      description: "Interactive food truck website featuring live location tracking, digital menu with ordering system, and customer reviews.",
      thumbnailPath: "/placeholder-foodtruck.jpg",
      category: "Food & Dining"
    },
    {
      id: "3",
      title: "Creative Canvas Portfolio",
      description: "Stunning portfolio site for a graphic designer with image galleries, client testimonials, and project case studies.",
      thumbnailPath: "/placeholder-portfolio.jpg",
      category: "Portfolio"
    },
    {
      id: "4",
      title: "LocalBiz Directory",
      description: "Comprehensive business directory with search filters, business profiles, reviews, and submission forms for new listings.",
      thumbnailPath: "/placeholder-directory.jpg",
      category: "Business"
    },
    {
      id: "5",
      title: "EventSpace Manager",
      description: "Event venue booking platform with calendar integration, space galleries, pricing calculator, and vendor coordination.",
      thumbnailPath: "/placeholder-events.jpg",
      category: "Events"
    },
    {
      id: "6",
      title: "EcoShop Marketplace",
      description: "Sustainable products e-commerce site with eco-friendly badges, carbon footprint tracking, and subscription boxes.",
      thumbnailPath: "/placeholder-ecommerce.jpg",
      category: "E-commerce"
    }
  ]

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
      const authDisabled = await isAuthDisabled();
      const isValid = authState.valid;

      if (!authDisabled && !isValid) {
        logger.info('page.auth.redirect', 'User not authenticated, redirecting to login')
        if (isFeatureEnabled.mockLogin()) {
          throw new Error('Please sign in using the mock authentication system')
        }
        window.location.href = await getLoginUrl(window.location.href)
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
      logger.info('page.site.quick-create.success', { message: 'Site record created instantly', siteId: siteData.id })

      // Immediately redirect to /create/{siteId} - deployment will happen there
      router.push(`/create/${siteData.id}`)
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
  }, [promptText, router, isRedirecting, isLoading, authState])

  const handleExampleClick = (examplePrompt: string) => {
    if (heroSectionRef.current) {
      heroSectionRef.current.typeText(examplePrompt)
    } else {
      // Fallback if ref is not available
      setPromptText(examplePrompt)
    }
  }

  return (
    <div className="min-h-screen">
      <div id="airo-sentinel-background">
        <div className="orbs-group">
          <div className="orb orb1"></div>
          <div className="orb orb2"></div>
          <div className="orb orb3"></div>
          <div className="orb orb4"></div>
        </div>
      </div>
      
      <Header 
        actions={
          <Button
            onClick={handleStartBuilding}
            data-partial={ !isLoading ? "componentAiro" : "componentBrand" }
            disabled={!promptText.trim() || isLoading}
            design='primary'
            className="group cursor-pointer transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center space-x-1">
              {isLoading ? (
                <>
                  <Spinner size='sm' />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <span>Get Started</span>
                </>
              )}
            </div>
          </Button>
        }
        className="absolute top-0 left-0 w-full border-0!"
      />

      <Box 
        className="mx-auto px-4 sm:px-6 lg:px-8 pt-24 min-h-screen"
        inlineAlignChildren='center'
        blockAlignChildren='center'
      >
        <HeroSection
          ref={heroSectionRef}
          promptText={promptText}
          setPromptText={setPromptText}
          onStartBuilding={handleStartBuilding}
          isLoading={isLoading}
          error={error}
          setError={setError}
        />

        <ExamplesSection
          examples={examples}
          onExampleClick={handleExampleClick}
        />
      </Box>

      <BuiltWithSection items={builtWithItems} />

      <Footer />
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeContent />
    </Suspense>
  )
}
