import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import { text } from '@ux/text'
import ArrowRightIcon from '@ux/icon/arrow-right'
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
    <Box className="text-center flex flex-col gap-4">
      <text.h1 
        as='heading'
        size={ 3 }
      >
        What would you like to{' '}
        <text.span as='heading' size={ 4 } className='ai-text-gradient -rotate-2'>
          build today?
        </text.span>
      </text.h1>

      <text.p
        size={ 2 }
        className='max-w-3xl mx-auto'
      >
        Describe your idea and watch our AI team of experts bring it to life. From concept to production, we handle everything.
      </text.p>

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
      <div className="w-full max-w-2xl mx-auto my-16">
        <div className="relative textarea-blur-bg">
          <textarea
            value={promptText}
            onChange={(e) => {
              setPromptText(e.target.value)
              // Clear error when user starts typing
              if (error) setError(null)
            }}
            rows={5}
            disabled={isLoading}
            className="relative z-10 w-full p-5 text-lg font-medium border-2 rounded transition-all resize-none disabled:opacity-50 disabled:cursor-not-allowed border-none outline-none bg-intents-ux-box-backgroundColor text-intents-ux-box-foregroundColor"
            placeholder="Describe the application you'd like to build..."
          />
          <Button 
            onClick={onStartBuilding}
            data-partial={ !isLoading ? "componentAiro" : "componentBrand" }
            disabled={!promptText.trim() || isLoading}
            design='primary'
            className="group cursor-pointer absolute right-3 bottom-5 mb-0.5 transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed z-10"
          >
            <div className="flex items-center space-x-1">
              {isLoading ? (
                <>
                  <span>Building...</span>
                  <Spinner size='sm' />
                </>
              ) : (
                <>
                  <span>Start Building</span>
                  <ArrowRightIcon className="w-4 h-4 transition-all group-hover:translate-x-1 group-disabled:translate-x-0" />
                </>
              )}
            </div>
          </Button>
        </div>
      </div>
    </Box>
  )
}
