import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react'
import { useAuth } from '@/hooks/useAuth';
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import { text } from '@ux/text'
import SendIcon from '@ux/icon/send'
import { HeroSectionProps, HeroSectionRef } from './types'
import { generateClickEID } from '@/utils/instrumentation'

const HeroSection = forwardRef<HeroSectionRef, HeroSectionProps>(({
  promptText,
  setPromptText,
  onStartBuilding,
  isLoading,
  error,
  setError,
  onShowMockLogin
}, ref) => {
  const [isTyping, setIsTyping] = useState(false)
  const [displayText, setDisplayText] = useState(promptText)
  const animationQueueRef = useRef<string[]>([])
  const lastErrorClearRef = useRef<string>('')
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const { 
    isAuthenticated,
    handleSignIn
  } = useAuth(onShowMockLogin);
  
  // Detect Safari browser
  const isSafari = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  }, [])

  useEffect(() => {
    setDisplayText(promptText)
  }, [promptText])

  // Debounced prompt text update for better performance
  const debouncedSetPromptText = useCallback((value: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      setPromptText(value)
    }, 50) // 50ms debounce
  }, [setPromptText])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  const typeText = useCallback(async (targetText: string) => {
    if (isLoading) return
    
    // Prevent animation if text is already the same
    if (displayText === targetText) return

    // Skip animation on Safari for better performance
    if (isSafari) {
      setDisplayText(targetText)
      setPromptText(targetText)
      return
    }

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
      // Only update parent state at the end to reduce re-renders
      if (i === targetText.length) {
        setPromptText(newText)
      }
      await new Promise(resolve => setTimeout(resolve, typingSpeed))
    }
    
    setIsTyping(false)
    animationQueueRef.current = []
  }, [isLoading, displayText, setPromptText, isSafari])

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

      <div className="w-full max-w-2xl mx-auto my-16">
        {/* Display Login button for unauthenticated users */}
        { !isAuthenticated && (
          <Button 
            onClick={() => handleSignIn(window.location.href)}
            design='primary'
            text='Sign In to Continue'
            data-eid={ generateClickEID('homepage.hero.sign_in') }
          />
        )}
        {/* Display Textarea for authenticated users */}
        { isAuthenticated && (
          <Box gap="lg">
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
                  debouncedSetPromptText(newValue)
                  // Clear error when user starts typing (avoid unnecessary calls)
                  if (error && lastErrorClearRef.current !== newValue) {
                    lastErrorClearRef.current = newValue
                    setError(null)
                  }
                }}
                rows={5}
                disabled={isLoading}
                className="relative z-10 w-full p-5 text-md font-medium rounded-lg resize-none border-0 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder={isTyping ? "" : "Describe the application you'd like to build..."}
              />
              <Button 
                onClick={onStartBuilding}
                data-partial={ !isLoading ? "componentAiro" : "componentBrand" }
                data-eid={ generateClickEID('homepage.prompt.submit') }
                disabled={!promptText.trim() || isLoading || isTyping}
                design='primary'
                className="group cursor-pointer absolute right-4 bottom-4 mb-0.5 transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed z-10"
                text={isLoading ? "Building..." : "Start Building"}
                icon={isLoading ? <Spinner size='sm' /> : <SendIcon className="w-4 h-4" />}
              />
            </Box>
            <text.p size={ -1 } className='max-w-lg mx-auto'>
              AI can make mistakes, so double check its responses. By using Airo App Builder, you agree to our <Button design="inline" size="sm" external href="https://www.godaddy.com/legal/agreements/ai-terms-of-use">Terms</Button> and <Button design="inline" size="sm" external href="https://www.godaddy.com/legal/agreements/privacy-policy">Privacy Policy</Button>
            </text.p>
          </Box>
        )}
      </div>
    </Box>
  )
})

HeroSection.displayName = 'HeroSection'

export default HeroSection
