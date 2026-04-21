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

import ExamplesSection from '@/app/[market]/components/HeroExamples'
import TemplateSelector from '@/app/[market]/components/TemplateSelector'
import { HeroSectionProps, HeroSectionRef } from '@/app/[market]/components/types'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useTranslations } from '@/hooks/useTranslations'
import { JourneyTracker } from '@/lib/journeyTracker'
import { getByteLength, MAX_PROMPT_BYTES, validateAndClampPrompt } from '@/lib/waf-validation'
import { generateClickEID } from '@/utils/instrumentation'
import { handleModifierEnterNewline } from '@/utils/textareaShortcuts'

const PROMPT_IDLE_MS = 30_000

const HeroSection = forwardRef<HeroSectionRef, HeroSectionProps>(({
  promptText,
  setPromptText,
  onStartBuilding,
  isLoading,
  error,
  setError,
  onExampleClick,
  selectedTemplate = 'default',
  onTemplateChange,
}, ref) => {
  const t = useTranslations();
  const { isAuthenticated } = useAuthContext()
  const { logAnalytics } = useAnalytics({
    experimentId: EXPERIMENT_IDS.homepageEngagement,
    baseData: { isAuthenticated },
  })
  const intl = useIntl();
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
    stop: stopSpeech,
    resetTranscript,
  } = useSpeechRecognition({ language: intl.locale })

  // Update text when speech transcript changes (replace, don't append)
  useEffect(function syncSpeechTranscript() {
    if (isListening && speechTranscript) {
      const baseText = textBeforeListeningRef.current
      const separator = baseText && !baseText.endsWith(' ') ? ' ' : ''
      const newText = baseText + separator + speechTranscript
      const validated = validateAndClampPrompt(newText)
      setDisplayText(validated.text)
      setPromptText(validated.text)
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
  }, [isListening])

  function handleStartBuilding() {
    // Flush any pending debounced promptText update so the parent has the latest value
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
      setPromptText(displayText)
    }
    if (isListening) {
      // Clear ref before stopping to prevent race condition with captureTextOnListeningStart effect
      textBeforeListeningRef.current = ''
      stopSpeech()
      resetTranscript()
    }
    JourneyTracker.current()?.trackMilestone('homepage_prompt_submitted', {
      promptLength: displayText.trim().length,
    })
    onStartBuilding()
  }

  // Keep expanded if focused OR has content OR listening
  const isExpanded = isFocused || displayText.trim().length > 0 || isListening
  const animationQueueRef = useRef<string[]>([])
  const lastErrorClearRef = useRef<string>('')
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hasLoggedFocusRef = useRef(false)
  const hasLoggedFirstInputRef = useRef(false)
  const firstInputTimeRef = useRef<number | null>(null)
  const placeholderTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Track prompt abandonment when user leaves with unsent text
  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading
  const displayTextRef = useRef(displayText)
  displayTextRef.current = displayText

  useEffect(function trackAbandonment() {
    function onVisibilityChange() {
      if (document.visibilityState !== 'hidden') return
      const text = displayTextRef.current.trim()
      if (text.length > 0 && !isLoadingRef.current && firstInputTimeRef.current) {
        logAnalytics('homepage.prompt.abandoned', {
          promptLength: text.length,
          msFromFirstInput: Date.now() - firstInputTimeRef.current,
          msFromPageLoad: Math.round(performance.now()),
        })
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [logAnalytics])

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(function trackPromptIdle() {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
    const trimmed = displayText.trim()
    if (trimmed.length === 0 || isLoading) {
      return
    }
    idleTimerRef.current = setTimeout(function onPromptIdle() {
      idleTimerRef.current = null
      if (isLoadingRef.current) {
        return
      }
      const text = displayTextRef.current.trim()
      if (text.length === 0) {
        return
      }
      logAnalytics('homepage.prompt.idle', {
        promptLength: text.length,
      })
    }, PROMPT_IDLE_MS)
    return function cleanupPromptIdle() {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
  }, [displayText, isLoading, logAnalytics])

  // Detect Safari browser
  const isSafari = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  }, [])

  const { isBelowSmBreakpoint, isMdBreakpoint } = useBreakpoints()

  // Memoize and shuffle placeholders once on mount
  // Use mobile-specific placeholders on mobile to prevent truncation
  const placeholders = useMemo(() => {
    if (isBelowSmBreakpoint) {
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
  }, [isBelowSmBreakpoint])
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

    // Validate and clamp to byte limit
    const validated = validateAndClampPrompt(targetText)
    const validatedText = validated.text

    // Prevent animation if text is already the same
    if (displayText === validatedText) return

    // Skip animation on Safari for better performance
    if (isSafari) {
      setDisplayText(validatedText)
      setPromptText(validatedText)
      return
    }

    const typingSpeed = 2

    setIsTyping(true)
    animationQueueRef.current = [validatedText]

    // First, clear existing text with backspace effect
    const currentText = displayText
    for (let i = currentText.length; i >= 0; i--) {
      if (animationQueueRef.current[0] !== validatedText) return // Animation was interrupted
      setDisplayText(currentText.slice(0, i))
      await new Promise(resolve => setTimeout(resolve, typingSpeed))
    }

    // Then type the new text
    for (let i = 0; i <= validatedText.length; i++) {
      if (animationQueueRef.current[0] !== validatedText) return // Animation was interrupted
      const newText = validatedText.slice(0, i)
      setDisplayText(newText)
      // Only update parent state at the end to reduce re-renders
      if (i === validatedText.length) {
        setPromptText(newText)
      }
      await new Promise(resolve => setTimeout(resolve, typingSpeed))
    }

    setIsTyping(false)
    animationQueueRef.current = []
  }, [isLoading, displayText, setPromptText, isSafari])

  useImperativeHandle(ref, () => ({
    typeText,
    getFirstInputTime: () => firstInputTimeRef.current
  }), [typeText])

  const scrollToNextSection = useCallback(() => {
    logAnalytics(
      'homepage.hero.scroll_cta_click',
      {
        msFromPageLoad: Math.round(performance.now()),
      },
      {
        kind: 'click',
        eid: 'homepage.hero.scroll_cta',
      },
    )
    const nextSection = document.getElementById('infra-section');

    // Calculate target position with fallback
    let targetPosition: number;
    if (nextSection) {
      const rect = nextSection.getBoundingClientRect();
      targetPosition = window.pageYOffset + rect.top;
    } else {
      targetPosition = window.pageYOffset + window.innerHeight;
    };

    const startPosition = window.pageYOffset;
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
  }, [logAnalytics])

  // Memoize aria-label to prevent translation errors on every render (20-33 times/second due to placeholder animation)
  // Use intl.formatMessage directly as intl instance is stable (unlike t which is recreated each render)
  const microphoneAriaLabel = useMemo(() => {
    return isListening
      ? intl.formatMessage({ id: 'builder_homepage_hero_stop_listening', defaultMessage: 'Stop listening' })
      : intl.formatMessage({ id: 'builder_homepage_hero_start_listening', defaultMessage: 'Start voice input' })
  }, [isListening, intl])

  const bytesRemaining = MAX_PROMPT_BYTES - getByteLength(displayText)
  const isOverLimit = bytesRemaining < 0
  const showCharCount = isExpanded && bytesRemaining <= 20

  return (
    <Box className="flex flex-col gap-2 md:gap-3 px-2 sm:px-3 lg:px-4 pt-6 md:pt-12 min-h-[calc(100vh-3rem)] items-center justify-center">
      <text.h1
        as='heading'
        size={isBelowSmBreakpoint ? 2 : isMdBreakpoint ? 3 : 4}
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
        <Box gap={isMdBreakpoint ? 'md' : 'lg'}>
          <div className={clsx('relative transition-all duration-300 ease-out glowing-input', {
            'glowing-input--disabled': isLoading
          })}>
            <Box
              className={clsx(
                'relative transition-all duration-300 ease-out !bg-transparent',
                'outline-none ring-1 ring-inset ring-[rgba(74,61,107,0.14)] shadow-sm',
                {
                  'rounded-2xl!': isExpanded,
                  'rounded-[3rem]!': !isExpanded,
                },
              )}
              elevation="float"
            >
              <textarea
                data-testid="homepage-prompt-input"
                aria-describedby="prompt-char-count"
                value={displayText}
                onChange={(e) => {
                  // Block input during typing animation or speech recognition to prevent
                  // conflicts between manual typing, animated text, and voice transcript.
                  // Users can stop listening to edit the transcript.
                  if (isTyping || isListening) return
                  const prevTrimmedLength = displayText.trim().length
                  const nextValue = e.target.value
                  if (!hasLoggedFirstInputRef.current) {
                    hasLoggedFirstInputRef.current = true
                    firstInputTimeRef.current = Date.now()
                    logAnalytics('homepage.prompt.first_input', {
                      msFromPageLoad: Math.round(performance.now()),
                    })
                    JourneyTracker.current()?.trackMilestone('homepage_prompt_typed')
                  }
                  isUserTypingRef.current = true
                  if (
                    prevTrimmedLength > 0 &&
                    nextValue.trim().length === 0 &&
                    firstInputTimeRef.current !== null
                  ) {
                    logAnalytics('homepage.prompt.cleared', {
                      previousLength: prevTrimmedLength,
                      msFromFirstInput: Date.now() - firstInputTimeRef.current,
                    })
                  }
                  setDisplayText(nextValue)
                  debouncedSetPromptText(nextValue)
                  if (error && lastErrorClearRef.current !== nextValue) {
                    lastErrorClearRef.current = nextValue
                    setError(null)
                  }
                }}
                onKeyDown={(e) => {
                  if (handleModifierEnterNewline(e, {
                    currentValue: displayText,
                    onValueChange: (nextValue) => {
                      setDisplayText(nextValue)
                      debouncedSetPromptText(nextValue)
                    },
                  })) {
                    return
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (displayText.trim() && !isLoading && !isTyping && !isOverLimit) {
                      handleStartBuilding()
                    }
                  }
                }}
                onFocus={() => {
                  setIsFocused(true)
                  if (!hasLoggedFocusRef.current) {
                    hasLoggedFocusRef.current = true
                    logAnalytics(
                      'homepage.prompt.focus',
                      {
                        msFromPageLoad: Math.round(performance.now()),
                      },
                      {
                        kind: 'action',
                        eid: 'homepage.prompt.input',
                        action: 'focus',
                      },
                    )
                    JourneyTracker.current()?.trackMilestone('homepage_prompt_focused')
                  }
                }}
                onBlur={() => {
                  setIsFocused(false)
                  isUserTypingRef.current = false
                }}
                rows={5}
                dir="auto"
                disabled={isLoading || isListening}
                className={clsx('!bg-intents-ux-box-backgroundColor relative ps-3 sm:ps-4 pe-8 sm:pe-12 py-2.5 sm:py-3 w-full text-md sm:text-xl leading-[1.5] font-light resize-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300', {
                  'h-24 md:h-32 rounded-2xl': isExpanded,
                  'h-8 sm:h-10 rounded-[3rem]': !isExpanded
                })}
                placeholder={isTyping ? "" : animatedPlaceholder}
              />


              <div
                id="prompt-char-count"
                role="status"
                aria-live="polite"
                className="absolute top-2.5 end-2 sm:top-3 sm:end-3 md:end-3.5"
              >
                {showCharCount && (
                  <text.p
                    size={0}
                    className={clsx('font-medium', { 'opacity-50': !isOverLimit })}
                    emphasis={isOverLimit ? 'critical' : undefined}
                  >
                    <span aria-hidden="true">
                      {isOverLimit ? `-${Math.abs(bytesRemaining)}` : bytesRemaining}
                    </span>
                    <span className="sr-only">
                      {isOverLimit
                        ? t('builder_homepage_hero_chars_over_limit', { count: Math.abs(bytesRemaining) },
                          `${Math.abs(bytesRemaining)} characters over limit`)
                        : t('builder_homepage_hero_chars_remaining', { count: bytesRemaining },
                          `${bytesRemaining} characters remaining`)}
                    </span>
                  </text.p>
                )}
              </div>

              {/* Action Buttons Container */}
              <div className={clsx('absolute flex items-center end-1.5 gap-0.5 transition-all duration-300', {
                'bottom-1/2 translate-y-1/2 -space-x-1': !isExpanded,
                'bottom-1.5': isExpanded
              })}>
                {isSpeechSupported && (
                  <Button
                    onClick={() => {
                      logAnalytics('homepage.prompt.speech_toggled', { active: !isListening })
                      toggleSpeech()
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    data-eid={generateClickEID('homepage.prompt.speech')}
                    disabled={isLoading || isTyping}
                    design={isListening ? 'primary' : 'control'}
                    className={clsx('cursor-pointer !rounded-full aspect-square !border-none', {
                      '!bg-intents-ux-feedbackHighContrastCritical-feedbackColor': isListening,
                      '!bg-transparent hover:!bg-intents-ux-boxLowContrast-backgroundColor': !isListening,
                    })}
                    icon={<MicIcon />}
                    aria-label={microphoneAriaLabel}
                    size={isBelowSmBreakpoint ? 'sm' : 'md'}
                  />
                )}
                <Button
                  onClick={handleStartBuilding}
                  data-partial="componentAiro"
                  data-eid={generateClickEID('homepage.prompt.submit')}
                  disabled={!displayText.trim() || isLoading || isTyping || isOverLimit}
                  design='primary'
                  className='cursor-pointer !rounded-full aspect-square !border-none'
                  icon={isLoading ? <Spinner size='sm' /> : <SendIcon />}
                  aria-label={isLoading ? t('builder_homepage_hero_prompt_button_loading') : t('builder_homepage_hero_prompt_button')}
                  size={isBelowSmBreakpoint ? 'sm' : 'md'}
                />
              </div>
            </Box>
          </div>
          {onTemplateChange && (
            <TemplateSelector selectedTemplate={selectedTemplate} onTemplateChange={onTemplateChange} />
          )}
          <text.p
            size={-1}
            className={clsx(
              'max-w-lg mx-auto mb-2 md:mb-4 text-center',
              'opacity-70',
            )}
          >
            <FormattedMessage
              id='builder_homepage_hero_disclaimer'
              values={{
                terms: (
                  <Button
                    design="inline"
                    size="sm"
                    external
                    href="https://www.godaddy.com/legal/agreements/ai-terms-of-use"
                    className='!text-intents-ux-text-textColor underline'
                    text={t('builder_homepage_hero_disclaimer_terms')}
                  />
                ),
                privacy_policy: (
                  <Button
                    design="inline"
                    size="sm"
                    external
                    href="https://www.godaddy.com/legal/agreements/privacy-policy"
                    className='!text-intents-ux-text-textColor underline'
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
            onClick={scrollToNextSection}
            className='mx-auto mt-2 flex items-center gap-1 text-sm opacity-60 hover:opacity-100 hover:cursor-pointer transition-opacity group text-intents-ux-text-textColor'
            data-eid={generateClickEID('homepage.hero.see_how_it_works')}
          >
            <Box blockAlignChildren='center' inlineAlignChildren='center' gap="md">
              <text.p size={0} className='font-medium'>{t('builder_homepage_hero_scroll')}</text.p>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 8 37" className="w-1 group-hover:translate-y-1 transition-all duration-500">
                <path
                  fill='#6b5b8e'
                  d="M3.646 36.789a.5.5 0 0 0 .708 0l3.182-3.182a.5.5 0 1 0-.708-.707L4 35.728 1.172 32.9a.5.5 0 0 0-.708.707zM4 0h-.5v36.435h1V0z"
                  opacity=".5"
                />
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
