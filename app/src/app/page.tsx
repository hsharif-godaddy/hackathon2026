'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { appFetch } from '@/lib/gasket-config'
import { appService } from '@/services/AppService'
import Header from './components/Header'
import HeroSection from './components/HeroSection'
import ExamplesSection from './components/ExamplesSection'
import BuiltWithSection from './components/BuiltWithSection'
import Footer from './components/Footer'
import { Example, BuiltWithItem } from './components/types'

export default function Home() {
  const [promptText, setPromptText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

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

  // Track if user is redirecting to prevent multiple calls
  const [isRedirecting, setIsRedirecting] = useState(false)
  
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
      // Generate a simple app name from the prompt (first few words)
      const words = promptText.trim().split(' ').slice(0, 3)
      const appName = words.length > 0 ? words.join(' ') : 'New App'
      
      // Create the app via AppService
      const response = await appService.createApp({
        name: appName,
        initialPrompt: promptText.trim()
      })

      // Check if user was redirected to SSO
      if (response.ssoRedirect) {
        console.log('User redirected to SSO for authentication')
        return
      }

      if (!response.ok) {
        let errorMessage = `Server responded with status ${response.status}`
        try {
          const errorData = await response.json()
          if (errorData.message) {
            errorMessage = errorData.message
          }
        } catch {
          // Ignore JSON parsing errors, use default message
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()
      const appId = data.app.id

      // Redirect to the new app's creation status page
      router.push(`/create/${appId}`)
    } catch (error) {
      console.error('Error creating app:', error)
      
      // Set user-friendly error message
      let errorMessage = 'Something went wrong. Please try again.'
      
      if (error instanceof Error) {
        if (error.message.includes('fetch')) {
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
  }, [promptText, router, isRedirecting, isLoading])

  const handleExampleClick = (examplePrompt: string) => {
    setPromptText(examplePrompt)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      <Header 
        onStartBuilding={handleStartBuilding}
        promptText={promptText}
        isLoading={isLoading}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <HeroSection
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
      </main>

      <BuiltWithSection items={builtWithItems} />

      <Footer />
    </div>
  )
}