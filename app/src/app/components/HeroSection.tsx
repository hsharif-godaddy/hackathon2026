import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import { text } from '@ux/text'
import SendIcon from '@ux/icon/send'
import { HeroSectionProps, HeroSectionRef } from './types'

const HeroSection = forwardRef<HeroSectionRef, HeroSectionProps>(({
  promptText,
  setPromptText,
  onStartBuilding,
  isLoading,
  error,
  setError
}, ref) => {
  const [isTyping, setIsTyping] = useState(false)
  const [displayText, setDisplayText] = useState(promptText)
  const animationQueueRef = useRef<string[]>([])

  useEffect(() => {
    setDisplayText(promptText)
  }, [promptText])

  const typeText = useCallback(async (targetText: string) => {
    if (isLoading) return
    
    // Prevent animation if text is already the same
    if (displayText === targetText) return

    const typingSpeed = 2
    
    setIsTyping(true)
    animationQueueRef.current = [targetText]
    
    // First, clear existing text with backspace effect
    const currentText = displayText
    for (let i = currentText.length; i >= 0; i--) {
      if (animationQueueRef.current[0] !== targetText) return // Animation was interrupted
      setDisplayText(currentText.slice(0, i))
      await new Promise(resolve => setTimeout(resolve, typingSpeed))
    }
    
    // Then type the new text
    for (let i = 0; i <= targetText.length; i++) {
      if (animationQueueRef.current[0] !== targetText) return // Animation was interrupted
      const newText = targetText.slice(0, i)
      setDisplayText(newText)
      setPromptText(newText)
      await new Promise(resolve => setTimeout(resolve, typingSpeed))
    }
    
    setIsTyping(false)
    animationQueueRef.current = []
  }, [isLoading, displayText, setPromptText])

  useImperativeHandle(ref, () => ({
    typeText
  }), [typeText])
  return (
    <Box className="text-center flex flex-col gap-4">
      <text.h1 
        as='heading'
        size={ 3 }
      >
        What would you like to{' '}
        <text.span as='heading' size={ 3 } className='ai-text-gradient'>
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
        <div className="w-full max-w-2xl mx-auto mt-12">
          <Alert
            emphasis="critical"
            title="Error"
            actions={ <Button design="inline" text="Dismiss" onClick={() => setError(null)} /> }
          >
            {error}
          </Alert>
        </div>
      )}

      {/* Main CTA Input */}
      <div className="w-full max-w-2xl mx-auto my-16">
        <Box 
          className="relative rounded-xl!"
          elevation="float"

        >
          <textarea
            value={displayText}
            onChange={(e) => {
              if (isTyping) return // Prevent user input during typing animation
              const newValue = e.target.value
              setDisplayText(newValue)
              setPromptText(newValue)
              // Clear error when user starts typing
              if (error) setError(null)
            }}
            rows={5}
            disabled={isLoading}
            className="relative z-10 w-full p-5 text-md font-medium rounded-lg transition-all resize-none border-0 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder={isTyping ? "" : "Describe the application you'd like to build..."}
          />
          <Button 
            onClick={onStartBuilding}
            data-partial={ !isLoading ? "componentAiro" : "componentBrand" }
            disabled={!promptText.trim() || isLoading || isTyping}
            design='primary'
            className="group cursor-pointer absolute right-4 bottom-4 mb-0.5 transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed z-10"
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
                  <SendIcon className="w-4 h-4" />
                </>
              )}
            </div>
          </Button>
        </Box>
      </div>
    </Box>
  )
})

HeroSection.displayName = 'HeroSection'

export default HeroSection
