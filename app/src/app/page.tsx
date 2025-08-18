'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRightIcon, SparklesIcon } from '@heroicons/react/24/outline'

export default function Home() {
  const [promptText, setPromptText] = useState("")
  const router = useRouter()

  const examples = [
    {
      title: "Fitness Studio Website",
      prompt: "I need a modern website for my local fitness studio. We offer personal training, group classes, and nutrition coaching. I want members to be able to book classes online, view schedules, and access workout plans."
    },
    {
      title: "Local Restaurant Landing Page",
      prompt: "Create a landing page for my family restaurant. I need to showcase our menu, allow online reservations, display our hours and location, and highlight customer reviews. Include a photo gallery of our dishes."
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

  const handleStartBuilding = () => {
    const encodedMessage = encodeURIComponent(promptText)
    router.push(`/develop?message=${encodedMessage}`)
  }

  const handleExampleClick = (examplePrompt: string) => {
    setPromptText(examplePrompt)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                <SparklesIcon className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                Airo
              </span>
            </div>
            <nav className="hidden md:flex space-x-8">
              <Link href="/develop" className="text-gray-600 hover:text-gray-900 transition-colors">
                Develop
              </Link>
            </nav>
            <div className="flex items-center space-x-4">
              <button className="text-gray-600 hover:text-gray-900 transition-colors">
                Sign In
              </button>
              <button
                onClick={handleStartBuilding}
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-2 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            What would you like to{' '}
            <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              build today?
            </span>
          </h1>
          <p className="text-xl text-gray-600 mb-12 max-w-3xl mx-auto">
            Describe your idea and watch our AI team of experts bring it to life. 
            From concept to production, we handle everything.
          </p>

          {/* Main CTA Input */}
          <div className="max-w-2xl mx-auto mb-16">
            <div className="relative">
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={4}
                className="w-full px-6 py-4 text-lg text-gray-900 font-medium border-2 border-gray-200 rounded-2xl focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 transition-all resize-none"
              />
              <button 
                onClick={handleStartBuilding}
                className="absolute right-3 bottom-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-2 rounded-xl hover:from-purple-700 hover:to-blue-700 transition-all flex items-center space-x-2"
              >
                <span>Start Building</span>
                <ArrowRightIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Example Links */}
          <div className="text-center mb-8">
            <p className="text-gray-500 mb-4 text-sm">Or try one of these popular examples:</p>
            <div className="flex flex-wrap justify-center gap-3 max-w-4xl mx-auto">
              {examples.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(example.prompt)}
                  className="group px-4 py-2 bg-white rounded-lg border border-gray-200 hover:border-purple-300 hover:shadow-md transition-all duration-200 text-sm cursor-pointer"
                >
                  <span className="font-medium text-gray-700 group-hover:text-purple-600 transition-colors">
                    {example.title}
                  </span>
                  <ArrowRightIcon className="w-3 h-3 ml-1 inline opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Features Preview */}
        <div className="mt-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Built by AI Experts, For You
            </h2>
            <p className="text-lg text-gray-600">
              Our team of specialized AI agents work together to build your application
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <SparklesIcon className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">AI-Powered Development</h3>
              <p className="text-gray-600">
                Our agents understand your requirements and write production-ready code
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <SparklesIcon className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Enterprise Grade</h3>
              <p className="text-gray-600">
                Built for scale with security, monitoring, and compliance included
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <SparklesIcon className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Deploy Anywhere</h3>
              <p className="text-gray-600">
                One-click deployment to our global infrastructure or your own cloud
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center text-gray-600">
            <p>&copy; 2024 Airo AI Builder. Built with AI for the future.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}