import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react'
import clsx from 'clsx'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import SendIcon from '@ux/icon/send'
import Spinner from '@ux/spinner'
import { text } from '@ux/text'
import { HeroSectionProps, HeroSectionRef } from './types'
import { generateClickEID } from '@/utils/instrumentation'
import { MAX_PROMPT_LENGTH } from '@/lib/features'
import ExamplesSection from '@/app/components/HeroExamples'

const HeroSection = forwardRef<HeroSectionRef, HeroSectionProps>(({
  promptText,
  setPromptText,
  onStartBuilding,
  isLoading,
  error,
  setError,
  onExampleClick
}, ref) => {
  const [isTyping, setIsTyping] = useState(false)
  const [displayText, setDisplayText] = useState(promptText)
  const [isFocused, setIsFocused] = useState(false)

  // Keep expanded if focused OR has content
  const isExpanded = isFocused || displayText.trim().length > 0
  const animationQueueRef = useRef<string[]>([])
  const lastErrorClearRef = useRef<string>('')
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

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

  const scrollToStartSection = useCallback(() => {
    const startPosition = window.pageYOffset;
    const targetPosition = startPosition + window.innerHeight;
    const duration = 1000;
    const startTime = Date.now();

    const animateScroll = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function for smoother animation
      const easeInOutQuad = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const easedProgress = easeInOutQuad(progress);

      const currentPosition = startPosition + (targetPosition - startPosition) * easedProgress;
      window.scrollTo(0, currentPosition);

      if (progress < 1) {
        requestAnimationFrame(animateScroll);
      }
    };

    requestAnimationFrame(animateScroll);
  }, [])

  return (
    <Box className="flex flex-col gap-3 px-2 sm:px-3 lg:px-4 pt-12 min-h-[calc(100vh-3rem)] items-center justify-center">
      <text.h1
        as='heading'
        size={4}
        className="text-center max-w-screen-md"
      >
        Share your idea and we&apos;ll handle the rest
      </text.h1>

      <text.p
        size={2}
        className='max-w-xl mx-auto !font-thin text-center'
      >
        We build it for you from concept to live web app
      </text.p>

      {/* Error Display */}
      {error && (
        <div className="w-full max-w-2xl mx-auto mt-6">
          <Alert
            emphasis="critical"
            title="Error"
            actions={<Button text="Dismiss" onClick={() => setError(null)} />}
          >
            {error}
          </Alert>
        </div>
      )}

      <div className="w-full max-w-2xl mx-auto my-4">
        <Box gap="lg">
          <div className={clsx('relative transition-all duration-300 ease-out glowing-input', {
            'glowing-input--disabled': isLoading
          })}>
            <Box
              className={clsx('relative transition-all duration-300 ease-out !bg-transparent outline-4 outline-solid outline-[rgba(0,0,0,0.15)]', {
                'rounded-2xl!': isExpanded,
                'rounded-[3rem]!': !isExpanded
              })}
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
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                rows={5}
                disabled={isLoading}
                maxLength={MAX_PROMPT_LENGTH + 1}
                className={clsx('!bg-intents-ux-box-backgroundColor relative pl-4 pr-12 py-3 w-full text-2xl leading-[1.4] font-light resize-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300', {
                  'h-32 rounded-2xl': isExpanded,
                  'h-10 rounded-[3rem]': !isExpanded
                })}
                placeholder={isTyping ? "" : "Describe your app idea..."}
              />
              <Button
                onClick={onStartBuilding}
                data-partial="componentAiro"
                data-eid={generateClickEID('homepage.prompt.submit')}
                disabled={!promptText.trim() || isLoading || isTyping || promptText.length >= MAX_PROMPT_LENGTH}
                design='primary'
                className="group cursor-pointer absolute transition-all duration-300 flex items-center disabled:opacity-50 disabled:cursor-not-allowed !rounded-full aspect-square !p-2 !border-none right-1.5 bottom-1.5"
                icon={isLoading ? <Spinner size='sm' /> : <SendIcon />}
                aria-label={isLoading ? "Building your app..." : "Start building"}
              />
            </Box>
          </div>
          {promptText.length >= MAX_PROMPT_LENGTH && isExpanded && (
            <div className="mt-0.5 px-4 text-left">
              <text.p
                size={0}
                className="font-medium"
                emphasis="critical"
              >
                Character limit reached ({MAX_PROMPT_LENGTH.toLocaleString()})
              </text.p>
            </div>
          )}

          <text.p size={-1} className='max-w-lg mx-auto opacity-40 mb-4 text-center'>
            AI can make mistakes, so double check its responses. By using Airo App Builder, you agree to our <Button design="inline" size="sm" external href="https://www.godaddy.com/legal/agreements/ai-terms-of-use" className="!text-intents-ux-boxHighContrast-foregroundColor" text="Terms" /> and <Button design="inline" size="sm" external href="https://www.godaddy.com/legal/agreements/privacy-policy" className="!text-intents-ux-boxHighContrast-foregroundColor" text="Privacy Policy" />.
          </text.p>

          <ExamplesSection
            onExampleClick={onExampleClick}
          />

          <button
            onClick={scrollToStartSection}
            className="mx-auto mt-2 flex items-center gap-1 text-sm opacity-60 hover:opacity-100 hover:cursor-pointer transition-opacity group"
            data-eid={generateClickEID('homepage.hero.see_how_it_works')}
          >
            <Box blockAlignChildren='center' inlineAlignChildren='center' gap="md">
              <text.p size={0} className='font-medium'>See how it works</text.p>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 8 37" className="w-1 group-hover:translate-y-1 transition-all duration-500">
                <path fill="#d3c1f7" d="M3.646 36.789a.5.5 0 0 0 .708 0l3.182-3.182a.5.5 0 1 0-.708-.707L4 35.728 1.172 32.9a.5.5 0 0 0-.708.707zM4 0h-.5v36.435h1V0z" opacity=".5" />
              </svg>
            </Box>
          </button>
        </Box>
      </div>
    </Box >
  )
})

HeroSection.displayName = 'HeroSection'

export default HeroSection
