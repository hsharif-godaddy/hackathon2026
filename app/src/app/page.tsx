'use client'

import { useState, useCallback, useEffect, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { appFetch } from '@/lib/gasket-config'
import { useAuth } from '@/hooks/useAuth'
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

function HomeContent() {
  const [promptText, setPromptText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const heroSectionRef = useRef<HeroSectionRef>(null)

  // Use reusable auth hook
  const { isAuthenticated, isAuthDisabled, gasketConfig } = useAuth()

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
      title: "Web Agency Website",
      description: "Comprehensive business directory with search filters, business profiles, reviews, and submission forms for new listings.",
      thumbnailPath: "/images/craft-code.png",
      category: "Business",
      prompt: "Website about a web agency specialized in creating beautiful handcrafted websites. Dark theme with vibrant color accent. Keep it low on images, rely on one impactful image and then use icons. Never use emojis"
    },
    {
      id: "2",
      title: "Ancient Mariners",
      description: "Interactive food truck website featuring live location tracking, digital menu with ordering system, and customer reviews.",
      thumbnailPath: "/images/ancient-mariners.png",
      category: "Education",
      prompt: "Minimalistic site about whales. Use marine colors, make it short but worth reading."
    },
    {
      id: "3",
      title: "Creative Canvas Portfolio",
      description: "Stunning portfolio site for a graphic designer with image galleries, client testimonials, and project case studies.",
      thumbnailPath: "/images/creative-portfolio.png",
      category: "Portfolio",
      prompt: "Stunning portfolio site for a graphic designer with image galleries, client testimonials, and project case studies."
    },
    {
      id: "4",
      title: "FitFlow Studio",
      description: "Modern fitness studio dashboard with online class booking, member portal, and trainer profiles.",
      thumbnailPath: "/images/fit-studio.png",
      category: "Health & Fitness",
      prompt: "Modern fitness studio dashboard with online class booking, member portal, and trainer profiles."
    },
    {
      id: "5",
      title: "Pepito Nachos",
      description: "Event venue booking platform with calendar integration, space galleries, pricing calculator, and vendor coordination.",
      thumbnailPath: "/images/pepito-nachos.png",
      category: "Food",
      prompt: "I need a website for my local Food Truck : Pepito Nachos, focused on offering mexican street food. We use avocado-styled colors with the food truck being all black."
    },
    {
      id: "6",
      title: "EcoShop Marketplace",
      description: "Sustainable products e-commerce site with eco-friendly badges, carbon footprint tracking, and subscription boxes. Focus should be on displaying products.",
      thumbnailPath: "/images/eco-mart.png",
      category: "E-commerce",
      prompt: "Sustainable products e-commerce site with eco-friendly badges, carbon footprint tracking, and subscription boxes. Focus should be on displaying products."
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
    <div className="w-full overflow-hidden">
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
          isAuthenticated ? (
            <Button
              onClick={handleStartBuilding}
              data-partial="componentAiro"
              design='primary'
              text='My Sites'
              href='/sites'
            />
          ) : undefined
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

      <BuiltWithSection 
        items={builtWithItems} 
        onExampleClick={handleExampleClick}
      />

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
