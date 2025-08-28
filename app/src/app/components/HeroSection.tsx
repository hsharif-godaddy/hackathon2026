import { ArrowRightIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { HeroSectionProps } from './types'

export default function HeroSection({
  promptText,
  setPromptText,
  onStartBuilding,
  isLoading,
  error,
  setError
}: HeroSectionProps) {
  return (
    <div className="text-center gd-fonts">
      <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6 mt-12">
        What would you like to{' '}
        <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
          build today?
        </span>
      </h1>
      <p className="text-xl text-gray-600 mb-16 max-w-3xl mx-auto">
        Describe your idea and watch our AI team of experts bring it to life. 
        From concept to production, we handle everything.
      </p>

      {/* Error Display */}
      {error && (
        <div className="max-w-2xl mx-auto mb-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start space-x-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-sm text-red-600 hover:text-red-800 mt-2 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main CTA Input */}
      <div className="max-w-2xl mx-auto mb-16">
        <div className="relative">
          <textarea
            value={promptText}
            onChange={(e) => {
              setPromptText(e.target.value)
              // Clear error when user starts typing
              if (error) setError(null)
            }}
            rows={5}
            disabled={isLoading}
            className="w-full p-5 text-lg text-gray-900 font-medium border-2 border-gray-200 rounded-2xl focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-200 transition-all resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Describe the application you'd like to build..."
          />
          <button 
            onClick={onStartBuilding}
            disabled={!promptText.trim() || isLoading}
            className="group cursor-pointer absolute right-4 bottom-5 mb-0.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-2 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Building...</span>
              </>
            ) : (
              <>
                <span>Start Building</span>
                <ArrowRightIcon className="w-4 h-4 transition-all group-hover:translate-x-1 group-disabled:translate-x-0" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
