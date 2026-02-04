import clsx from 'clsx'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import MicIcon from '@ux/icon/mic'
import SendIcon from '@ux/icon/send'
import Spinner from '@ux/spinner'
import { text } from '@ux/text'

import ExamplesSection from '@/app/components/HeroExamples'
import { useResponsive } from '@/hooks/useResponsive'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useTranslations } from '@/hooks/useTranslations'
import { MAX_PROMPT_LENGTH } from '@/lib/features'
import { generateClickEID } from '@/utils/instrumentation'
import { HeroSectionProps, HeroSectionRef } from './types'

const HeroSection = forwardRef<HeroSectionRef, HeroSectionProps>(({
  promptText,
  setPromptText,
  onStartBuilding,
  isLoading,
  error,
  setError,
  onExampleClick
}, ref) => {
  const t = useTranslations();
  const { locale } = useIntl();
  const [isTyping, setIsTyping] = useState(false)
  const [displayText, setDisplayText] = useState(promptText)
  const [isFocused, setIsFocused] = useState(false)
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState('')

  // Speech recognition - track text before listening started
  const textBeforeListeningRef = useRef('')

  const {
    isListening,
    isSupported: isSpeechSupported,
    toggle: toggleSpeech,
    transcript: speechTranscript,
  } = useSpeechRecognition({ language: locale })

  // Update text when speech transcript changes (replace, don't append)
  useEffect(function syncSpeechTranscript() {
    if (isListening && speechTranscript) {
      const baseText = textBeforeListeningRef.current
      const separator = baseText && !baseText.endsWith(' ') ? ' ' : ''
      const newText = baseText + separator + speechTranscript
      setDisplayText(newText)
      setPromptText(newText)
    }
  }, [isListening, speechTranscript, setPromptText])

  // Store text when listening starts
  // Note: displayText is intentionally omitted from dependencies. We want to capture
  // the current displayText value only when listening starts, not re-run this effect
  // when displayText changes during listening (which would overwrite the captured value).
  useEffect(function captureTextOnListeningStart() {
    if (isListening) {
      textBeforeListeningRef.current = displayText
    }
  }, [isListening]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep expanded if focused OR has content OR listening
  const isExpanded = isFocused || displayText.trim().length > 0 || isListening
  const animationQueueRef = useRef<string[]>([])
  const lastErrorClearRef = useRef<string>('')
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const placeholderTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Detect Safari browser
  const isSafari = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  }, [])

  const { isMobile, isTablet } = useResponsive()

  // Memoize and shuffle placeholders once on mount
  // Use mobile-specific placeholders on mobile to prevent truncation
  const placeholders = useMemo(() => {
    if (isMobile) {
      return [
        t('builder_homepage_placeholder_mobile_1'),
        t('builder_homepage_placeholder_mobile_2'),
        t('builder_homepage_placeholder_mobile_3')
      ]
    }
    return [
      t('builder_homepage_placeholder_1'),
      t('builder_homepage_placeholder_2'),
      t('builder_homepage_placeholder_3'),
      t('builder_homepage_placeholder_4'),
      t('builder_homepage_placeholder_5')
    ].sort(() => Math.random() - 0.5)
  }, [isMobile]) // eslint-disable-line react-hooks/exhaustive-deps
  const isUserTypingRef = useRef(false)

  useEffect(() => {
    // Only sync if not from user input (e.g., example click)
    if (!isUserTypingRef.current) {
      setDisplayText(promptText)
    }
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

  // Animated placeholder effect
  useEffect(() => {
    if (isFocused || displayText.trim().length > 0) {
      setAnimatedPlaceholder('')
      return
    }

    // Safari: show static first placeholder without animation
    if (isSafari) {
      setAnimatedPlaceholder(placeholders[0])
      return
    }

    let currentIndex = 0
    let currentCharIndex = 0
    let isDeleting = false

    const animatePlaceholder = () => {
      const currentText = placeholders[currentIndex]

      if (!isDeleting) {
        if (currentCharIndex <= currentText.length) {
          setAnimatedPlaceholder(currentText.slice(0, currentCharIndex))
          currentCharIndex++
          placeholderTimerRef.current = setTimeout(animatePlaceholder, 50)
        } else {
          placeholderTimerRef.current = setTimeout(() => {
            isDeleting = true
            animatePlaceholder()
          }, 2000)
        }
      } else {
        if (currentCharIndex > 0) {
          currentCharIndex--
          setAnimatedPlaceholder(currentText.slice(0, currentCharIndex))
          placeholderTimerRef.current = setTimeout(animatePlaceholder, 30)
        } else {
          isDeleting = false
          currentIndex = (currentIndex + 1) % placeholders.length
          currentCharIndex = 0
          placeholderTimerRef.current = setTimeout(animatePlaceholder, 500)
        }
      }
    }

    animatePlaceholder()

    return () => {
      if (placeholderTimerRef.current) {
        clearTimeout(placeholderTimerRef.current)
      }
    }
  }, [isFocused, displayText, isSafari, placeholders])

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
    <Box className="flex flex-col gap-2 md:gap-3 px-2 sm:px-3 lg:px-4 pt-6 md:pt-12 min-h-[calc(100vh-3rem)] items-center justify-center">
      <text.h1
        as='heading'
        size={isMobile ? 2 : isTablet ? 3 : 4}
        className="text-center max-w-screen-md"
      >
        {t('builder_homepage_hero_title')}
      </text.h1>

      <text.p
        size={2}
        className='max-w-xl mx-auto !font-thin text-center text-pretty'
      >
        {t('builder_homepage_hero_text')}
      </text.p>

      {/* Error Display */}
      {error && (
        <div className="w-full max-w-2xl mx-auto mt-6">
          <Alert
            emphasis="critical"
            title={t('builder_status_error')}
            actions={<Button text={t('builder_common_dismiss')} onClick={() => setError(null)} />}
          >
            {error}
          </Alert>
        </div>
      )}

      <div className="w-full max-w-2xl mx-auto my-2 md:my-4">
        <Box gap={isTablet ? 'md' : 'lg'}>
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
                data-testid="homepage-prompt-input"
                value={displayText}
                onChange={(e) => {
                  // Block input during typing animation or speech recognition to prevent
                  // conflicts between manual typing, animated text, and voice transcript.
                  // Users can stop listening to edit the transcript.
                  if (isTyping || isListening) return
                  const newValue = e.target.value
                  isUserTypingRef.current = true
                  setDisplayText(newValue)
                  debouncedSetPromptText(newValue)
                  // Clear error when user starts typing (avoid unnecessary calls)
                  if (error && lastErrorClearRef.current !== newValue) {
                    lastErrorClearRef.current = newValue
                    setError(null)
                  }
                }}
                onFocus={() => setIsFocused(true)}
                onBlur={() => {
                  setIsFocused(false)
                  isUserTypingRef.current = false
                }}
                rows={5}
                disabled={isLoading || isListening}
                maxLength={MAX_PROMPT_LENGTH + 1}
                className={clsx('!bg-intents-ux-box-backgroundColor relative pl-3 sm:pl-4 pr-8 sm:pr-12 py-2.5 sm:py-3 w-full text-md sm:text-xl leading-[1.5] font-light resize-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300', {
                  'h-24 md:h-32 rounded-2xl': isExpanded,
                  'h-8 sm:h-10 rounded-[3rem]': !isExpanded
                })}
                placeholder={isTyping ? "" : animatedPlaceholder}
              />


              {/* Action Buttons Container */}
              <div className={clsx('absolute flex items-center right-1.5 transition-all duration-300', {
                'bottom-1/2 translate-y-1/2 -space-x-1': !isExpanded,
                'bottom-1.5 gap-1': isExpanded
              })}>
                {isSpeechSupported && (
                  <Button
                    onClick={toggleSpeech}
                    onMouseDown={(e) => e.preventDefault()}
                    data-eid={generateClickEID('homepage.prompt.speech')}
                    disabled={isLoading || isTyping}
                    design="control"
                    className={clsx(
                      'cursor-pointer !rounded-full aspect-square !border-none !outline-none !ring-0',
                      isListening
                        ? '!bg-intents-ux-boxLowContrast-backgroundColor [&_svg]:!text-intents-ux-box-foregroundColor'
                        : '!bg-transparent'
                    )}
                    icon={<MicIcon />}
                    size={isMobile ? 'sm' : 'md'}
                  />
                )}
                <Button
                  onClick={onStartBuilding}
                  data-partial="componentAiro"
                  data-eid={generateClickEID('homepage.prompt.submit')}
                  disabled={!promptText.trim() || isLoading || isTyping || promptText.length >= MAX_PROMPT_LENGTH}
                  design='primary'
                  className='cursor-pointer !rounded-full aspect-square !border-none'
                  icon={isLoading ? <Spinner size='sm' /> : <SendIcon />}
                  aria-label={isLoading ? t('builder_homepage_hero_prompt_button_loading') : t('builder_homepage_hero_prompt_button')}
                  size={isMobile ? 'sm' : 'md'}
                />
              </div>
            </Box>
          </div>
          {promptText.length >= MAX_PROMPT_LENGTH && isExpanded && (
            <div className="mt-0.5 px-4 text-left">
              <text.p
                size={0}
                className="font-medium"
                emphasis="critical"
              >
                {t('builder_homepage_hero_limit')} ({MAX_PROMPT_LENGTH.toLocaleString()})
              </text.p>
            </div>
          )}

          <text.p size={-1} className='max-w-lg mx-auto opacity-40 mb-2 md:mb-4 text-center'>
            <FormattedMessage
              id='builder_homepage_hero_disclaimer'
              values={{
                terms: (
                  <Button
                    design="inline"
                    size="sm"
                    external
                    href="https://www.godaddy.com/legal/agreements/ai-terms-of-use"
                    className="!text-intents-ux-boxHighContrast-foregroundColor"
                    text={t('builder_homepage_hero_disclaimer_terms')}
                  />
                ),
                privacy_policy: (
                  <Button
                    design="inline"
                    size="sm"
                    external
                    href="https://www.godaddy.com/legal/agreements/privacy-policy"
                    className="!text-intents-ux-boxHighContrast-foregroundColor"
                    text={t('builder_homepage_hero_disclaimer_privacy')}
                  />
                )
              }}
            />
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
              <text.p size={0} className='font-medium'>{t('builder_homepage_hero_scroll')}</text.p>
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
