import clsx from 'clsx'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import Box from '@ux/box'
import Button from '@ux/button'
import SendIcon from '@ux/icon/send'
import { text } from '@ux/text'

import ExamplesSection from '@/app/[market]/components/HeroExamples'
import TemplateSelector from '@/app/[market]/components/TemplateSelector'
import { HeroScrollButton } from '@/components/home/HeroScrollButton'
import { PromptCharCount } from '@/components/home/PromptCharCount'
import { PromptErrorAlert } from '@/components/home/PromptErrorAlert'
import { SpeechToggleButton } from '@/components/home/SpeechToggleButton'
import { SubmitInitialPrompt } from '@/components/home/SubmitInitialPrompt'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { HOMEPAGE_ENGAGEMENT_COHORT_IDS } from '@/experiments/homepage-engagement-variations/cohort-ids'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useImpression } from '@/hooks/useImpression'
import { useRTL } from '@/hooks/useRTL'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTextareaHoverTracking } from '@/hooks/useTextareaHoverTracking'
import { useTranslations } from '@/hooks/useTranslations'
import { JourneyTracker } from '@/lib/journeyTracker'
import { getByteLength, MAX_PROMPT_BYTES, validateAndClampPrompt } from '@/lib/waf-validation'
import { handleModifierEnterNewline } from '@/utils/textareaShortcuts'
import DesignFileUpload, { DesignFileUploadCard } from './DesignFileUpload'
import { HeroSectionProps, HeroSectionRef } from './types'

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
  headingText,
  subheadingText,
  uploadedFile,
  onFileChange,
}, ref) => {
  const t = useTranslations();
  useImpression('homepage.firstprompt.view', { customProperties: { variant: HOMEPAGE_ENGAGEMENT_COHORT_IDS.ORIGINAL } })
  const isTemplateSelectorEnabled = useSwitchboard('appbuilder-template-selector')
  const { isAuthenticated } = useAuthContext()
  const { logAnalytics } = useAnalytics({
    experimentId: EXPERIMENT_IDS.homepageEngagement,
    baseData: { isAuthenticated },
  })
  const intl = useIntl();
  const isRTL = useRTL();
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

  const animationQueueRef = useRef<string[]>([])
  const lastErrorClearRef = useRef<string>('')
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hasLoggedFocusRef = useRef(false)
  const hasLoggedFirstInputRef = useRef(false)
  const firstInputTimeRef = useRef<number | null>(null)
  const placeholderTimerRef = useRef<NodeJS.Timeout | null>(null)

  const {
    onMouseEnter: onPromptBoxMouseEnter,
    onMouseLeave: onPromptBoxMouseLeave,
    snapshotHoverMs,
  } = useTextareaHoverTracking(logAnalytics)

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

  const placeholders = useMemo(
    function buildShuffledPlaceholders() {
      return [
        intl.formatMessage({ id: 'builder_homepage_placeholder_1' }),
        intl.formatMessage({ id: 'builder_homepage_placeholder_2' }),
        intl.formatMessage({ id: 'builder_homepage_placeholder_3' }),
        intl.formatMessage({ id: 'builder_homepage_placeholder_4' }),
        intl.formatMessage({ id: 'builder_homepage_placeholder_5' }),
      ].sort(() => Math.random() - 0.5)
    }, [intl])
  const isUserTypingRef = useRef(false)
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const promptTextareaResizeRafRef = useRef<number | null>(null)

  const fitPromptTextarea = useCallback(function fitPromptTextarea() {
    const el = promptTextareaRef.current
    if (!el) return
    const maxHeightPx = parseFloat(getComputedStyle(el).maxHeight)
    el.style.height = '0px'
    const scrollHeight = el.scrollHeight
    const capped =
      Number.isFinite(maxHeightPx) && maxHeightPx > 0
        ? Math.min(scrollHeight, maxHeightPx)
        : scrollHeight
    el.style.height = `${capped}px`
  }, [])

  useLayoutEffect(function syncPromptTextareaHeight() {
    fitPromptTextarea()
  }, [displayText, fitPromptTextarea, isBelowSmBreakpoint, isMdBreakpoint])

  useEffect(function syncPromptTextareaHeightOnResize() {
    function onResize() {
      if (promptTextareaResizeRafRef.current !== null) {
        cancelAnimationFrame(promptTextareaResizeRafRef.current)
      }
      promptTextareaResizeRafRef.current = requestAnimationFrame(function runFitPromptTextarea() {
        promptTextareaResizeRafRef.current = null
        fitPromptTextarea()
      })
    }
    window.addEventListener('resize', onResize, { passive: true })
    return function cleanupPromptTextareaResize() {
      window.removeEventListener('resize', onResize)
      if (promptTextareaResizeRafRef.current !== null) {
        cancelAnimationFrame(promptTextareaResizeRafRef.current)
        promptTextareaResizeRafRef.current = null
      }
    }
  }, [fitPromptTextarea])

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
          // For RTL, slice from the end; for LTR, slice from the start
          const displayedText = isRTL
            ? currentText.slice(currentText.length - currentCharIndex)
            : currentText.slice(0, currentCharIndex)
          setAnimatedPlaceholder(displayedText)
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
          // For RTL, slice from the end; for LTR, slice from the start
          const displayedText = isRTL
            ? currentText.slice(currentText.length - currentCharIndex)
            : currentText.slice(0, currentCharIndex)
          setAnimatedPlaceholder(displayedText)
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
  }, [isFocused, displayText, isSafari, placeholders, isRTL])

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
      // For RTL, slice from the end; for LTR, slice from the start
      const displayedText = isRTL
        ? currentText.slice(currentText.length - i)
        : currentText.slice(0, i)
      setDisplayText(displayedText)
      await new Promise(resolve => setTimeout(resolve, typingSpeed))
    }

    // Then type the new text
    for (let i = 0; i <= validatedText.length; i++) {
      if (animationQueueRef.current[0] !== validatedText) return // Animation was interrupted
      // For RTL, slice from the end; for LTR, slice from the start
      const newText = isRTL
        ? validatedText.slice(validatedText.length - i)
        : validatedText.slice(0, i)
      setDisplayText(newText)
      // Only update parent state at the end to reduce re-renders
      if (i === validatedText.length) {
        setPromptText(validatedText)
      }
      await new Promise(resolve => setTimeout(resolve, typingSpeed))
    }

    setIsTyping(false)
    animationQueueRef.current = []
  }, [isLoading, displayText, setPromptText, isSafari, isRTL])

  useImperativeHandle(ref, () => ({
    typeText,
    getFirstInputTime: () => firstInputTimeRef.current
  }), [typeText])

  const bytesRemaining = MAX_PROMPT_BYTES - getByteLength(displayText)
  const isOverLimit = bytesRemaining < 0

  return (
    <Box className="flex flex-col gap-2 md:gap-3 px-2 sm:px-3 lg:px-4 pt-12 min-h-[calc(100vh-3rem)] items-center justify-center">
      <text.h1
        as='heading'
        size={isBelowSmBreakpoint ? 2 : isMdBreakpoint ? 3 : 4}
        className="text-center max-w-screen-lg text-balance"
      >
        {headingText || t('builder_homepage_hero_title')}
      </text.h1>

      <text.p
        size={2}
        className='max-w-xl mx-auto !font-thin text-center text-pretty'
      >
        {subheadingText || t('builder_homepage_hero_text')}
      </text.p>

      <PromptErrorAlert error={error} onDismiss={() => setError(null)} />

      <div className="w-full max-w-2xl mx-auto my-2 md:my-4">
        <Box gap={isMdBreakpoint ? 'md' : 'lg'}>
          <div
            className={clsx('relative transition-all duration-300 ease-out glowing-input', {
              'glowing-input--disabled': isLoading
            })}
            onMouseEnter={onPromptBoxMouseEnter}
            onMouseLeave={onPromptBoxMouseLeave}
          >
            <Box
              className="rounded-2xl! p-2 transition-all duration-300 ease-out bg-intents-ux-box-backgroundColor outline-4 outline-solid outline-[rgba(0,0,0,0.15)]"
              elevation="float"
              gap={isBelowSmBreakpoint ? 'sm' : 'md'}
            >
              {/* Uploaded File Card */}
              {uploadedFile && onFileChange && (
                <DesignFileUploadCard
                  uploadedFile={uploadedFile}
                  onRemove={() => onFileChange(null)}
                  disabled={isLoading}
                />
              )}

              {/* Prompt Textarea */}
              <textarea
                ref={promptTextareaRef}
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
                    const hoverMsBeforeFocus = snapshotHoverMs()
                    logAnalytics(
                      'homepage.prompt.focus',
                      {
                        msFromPageLoad: Math.round(performance.now()),
                        hoverMsBeforeFocus,
                      },
                      {
                        kind: 'action',
                        eid: 'homepage.prompt.input',
                        action: 'focus',
                      },
                    )
                    // Flip the guard only after the focus log succeeds — if
                    // logAnalytics throws, a future onFocus retries the
                    // emission (matches useTextareaHoverTracking's retry-on-
                    // throw rationale). Placing it before the hover_time
                    // emission avoids a duplicate focus event if the
                    // hover_time call alone throws; hover_time has no retry
                    // path anyway because snapshotHoverMs already consumed
                    // the accumulator above.
                    hasLoggedFocusRef.current = true
                    if (hoverMsBeforeFocus > 0) {
                      logAnalytics('homepage.prompt.hover_time', {
                        totalHoverMs: hoverMsBeforeFocus,
                        trigger: 'focus',
                      })
                    }
                    JourneyTracker.current()?.trackMilestone('homepage_prompt_focused')
                  }
                }}
                onBlur={() => {
                  setIsFocused(false)
                  isUserTypingRef.current = false
                }}
                dir={isRTL ? 'rtl' : 'ltr'}
                disabled={isLoading || isListening}
                className="w-full min-h-6 md:min-h-8 max-h-20 md:max-h-24 bg-transparent overflow-y-auto text-md sm:text-xl font-light resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-300"
                placeholder={isTyping ? "" : animatedPlaceholder}
              />

              <Box orientation="horizontal" blockAlignChildren="spaceBetween" inlineAlignChildren="end">
                {/* Character Counter */}
                <PromptCharCount bytesRemaining={bytesRemaining} isOverLimit={isOverLimit} />
                {/* Action Buttons Container */}
                <Box orientation="horizontal" gap="sm">
                  {onFileChange && (
                    <DesignFileUpload
                      uploadedFile={uploadedFile ?? null}
                      onFileChange={onFileChange}
                      disabled={isLoading}
                    />
                  )}
                  {isSpeechSupported && (
                    <SpeechToggleButton
                      isListening={isListening}
                      isLoading={isLoading}
                      isTyping={isTyping}
                      onToggle={() => {
                        logAnalytics('homepage.prompt.speech_toggled', { active: !isListening })
                        toggleSpeech()
                      }}
                    />
                  )}
                  <SubmitInitialPrompt
                    onClick={handleStartBuilding}
                    disabled={!displayText.trim() || isLoading || isTyping || isOverLimit}
                    isLoading={isLoading}
                    icon={<SendIcon />}
                  />
                </Box>
              </Box>
            </Box>
          </div>

          {/* Template Selector */}
          {/* Template selector is used for internal experiments in TLA accounts only; customers won't see it. */}
          {isTemplateSelectorEnabled && onTemplateChange && (
            <TemplateSelector selectedTemplate={selectedTemplate} onTemplateChange={onTemplateChange} />
          )}

          {/* Disclaimer */}
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
            onTemplateChange={onTemplateChange}
          />

          <HeroScrollButton sectionId="infra-section" />
        </Box>
      </div>
    </Box >
  )
})

HeroSection.displayName = 'HeroSection'

export default HeroSection
