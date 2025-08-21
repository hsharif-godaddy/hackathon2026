import React from 'react'
import GeometricLoader from './components/GeometricLoader'

export default function Home() {
  return (
    <main className="min-h-screen p-4 space-y-8">
      {/* Header Section */}
      <header className="text-center py-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Welcome to My App</h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Built with Airo AI Builder. This is a sample application to demonstrate 
          the development tools and element selection capabilities.
        </p>
        <div className="mt-6">
          <button className="bg-blue-600 text-white px-6 py-3 rounded-lg text-lg font-semibold hover:bg-blue-700 transition-colors mr-4">
            Get Started
          </button>
          <button className="bg-transparent border-2 border-blue-600 text-blue-600 px-6 py-3 rounded-lg text-lg font-semibold hover:bg-blue-50 transition-colors">
            Learn More
          </button>
        </div>
      </header>

      {/* Content Sections */}
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Feature Cards */}
        <section className="grid md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
            <h3 className="text-xl font-semibold text-blue-600 mb-3">Feature One</h3>
            <p className="text-gray-700">
              This is a sample feature card with some content to demonstrate 
              element selection and styling capabilities.
            </p>
            <button className="mt-4 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors">
              Learn More
            </button>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
            <h3 className="text-xl font-semibold text-green-600 mb-3">Feature Two</h3>
            <p className="text-gray-700">
              Another feature card with different styling to show variety 
              in element selection and CSS property inspection.
            </p>
            <button className="mt-4 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors">
              Explore
            </button>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
            <h3 className="text-xl font-semibold text-purple-600 mb-3">Feature Three</h3>
            <p className="text-gray-700">
              A third feature card to complete the grid layout and provide 
              more elements for testing the development tools.
            </p>
            <button className="mt-4 bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition-colors">
              Discover
            </button>
          </div>
        </section>

        {/* Geometric Loader Section */}
        <section className="text-center py-12 bg-gray-50 rounded-lg">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Loading Animation</h2>
          <div className="flex flex-col items-center justify-center">
            <GeometricLoader />
            <p className="mt-4 text-sm text-gray-600">Geometric loader component</p>
          </div>
        </section>

        {/* Sample Form */}
        <section className="bg-white p-8 rounded-lg shadow-md border border-gray-200">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Sample Form</h2>
          <form className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                type="text"
                id="name"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your name"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                id="email"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your email"
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
                Message
              </label>
              <textarea
                id="message"
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your message"
              ></textarea>
            </div>
            <button
              type="submit"
              className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Submit
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
