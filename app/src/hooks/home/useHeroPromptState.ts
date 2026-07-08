'use client'

import { type ChangeEvent, type KeyboardEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { DEFAULT_STARTER_CATEGORY, type StarterCategory } from '@/components/home-page/starterCategories'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { usePromptStarter } from '@/experiments/prompt-starter/usePromptStarter'
import { useTemplateSelector } from '@/hooks/home/useTemplateSelector'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useTextareaHoverTracking } from '@/hooks/useTextareaHoverTracking'
import { JourneyTracker } from '@/lib/journeyTracker'
import { getByteLength, MAX_PROMPT_BYTES, validateAndClampPrompt } from '@/lib/waf-validation'
import { isSafari } from '@/utils/browser'
import { handleModifierEnterNewline } from '@/utils/textareaShortcuts'
import { useSpeechPromptInput } from './useSpeechPromptInput'

const PROMPT_IDLE_MS = 30_000

interface UseHeroPromptStateParams {
  promptText: string
  setPromptText: (text: string) => void
  onStartBuilding: (options?: { analytics?: Record<string, unknown> }) => void
  isLoading: boolean
  error: string | null
  setError: (error: string | null) => void
  isRTL?: boolean
}

interface UseHeroPromptStateReturn {
  isTemplateSelectorEnabled: boolean | undefined
  isTyping: boolean
  displayText: string
  isFocused: boolean
  firstInputTimeRef: RefObject<number | null>
  handleTextareaChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  handleTextareaKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  handleTextareaFocus: () => void
  handleTextareaBlur: () => void
  handleStartBuilding: () => void
  handleSpeechToggle: () => void
  typeText: (targetText: string) => Promise<void>
  isListening: boolean
  isSpeechSupported: boolean
  onPromptBoxMouseEnter: () => void
  onPromptBoxMouseLeave: () => void
  bytesRemaining: number
  isOverLimit: boolean
  isPromptStarterEnabled: boolean
  selectedStarterCategory: StarterCategory | null
  selectCategory: (category: StarterCategory) => void
}

export function useHeroPromptState({
  promptText,
  setPromptText,
  onStartBuilding,
  isLoading,
  error,
  setError,
  isRTL = false,
}: UseHeroPromptStateParams): UseHeroPromptStateReturn {
  const isTemplateSelectorEnabled = useTemplateSelector()
  const { isAuthenticated } = useAuthContext()
  const { logAnalytics } = useAnalytics({
    baseData: { isAuthenticated },
  })
  const isPromptStarterEnabled: boolean = usePromptStarter()
  const [isTyping, setIsTyping] = useState(false)
  const [displayText, setDisplayText] = useState(promptText)
  const [isFocused, setIsFocused] = useState(false)
  const [selectedStarterCategory, setSelectedStarterCategory] = useState<StarterCategory | null>(null)

  const animationQueueRef = useRef<string[]>([])
  const lastErrorClearRef = useRef<string>('')
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hasLoggedFocusRef = useRef(false)
  const hasLoggedFirstInputRef = useRef(false)
  const firstInputTimeRef = useRef<number | null>(null)
  const isUserTypingRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading
  const displayTextRef = useRef(displayText)
  displayTextRef.current = displayText

  const {
    onMouseEnter: onPromptBoxMouseEnter,
    onMouseLeave: onPromptBoxMouseLeave,
    snapshotHoverMs,
  } = useTextareaHoverTracking(logAnalytics)

  const { isListening, isSpeechSupported, toggleSpeech, stopSpeechForSubmit } = useSpeechPromptInput({
    displayText,
    setDisplayText,
    setPromptText,
  })

  useEffect(function trackAbandonment() {
    function onVisibilityChange(): void {
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
    return (): void => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [logAnalytics])

  useEffect(function trackPromptIdle() {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
    const trimmed = displayText.trim()
    if (trimmed.length === 0 || isLoading) {
      return
    }
    idleTimerRef.current = setTimeout(function onPromptIdle(): void {
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
    return function cleanupPromptIdle(): void {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
  }, [displayText, isLoading, logAnalytics])

  // Debounced prompt text update for better performance
  const debouncedSetPromptText = useCallback((value: string): void => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout((): void => {
      setPromptText(value)
    }, 50) // 50ms debounce
  }, [setPromptText])

  // Cleanup debounce timer on unmount
  useEffect((): (() => void) => {
    return (): void => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  useEffect((): void => {
    // Only sync if not from user input (e.g., example click)
    if (!isUserTypingRef.current) {
      setDisplayText(promptText)
    }
  }, [promptText])

  function handleStartBuilding(): void {
    // Flush any pending debounced promptText update so the parent has the latest value
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
      setPromptText(displayText)
    }
    if (isListening) {
      stopSpeechForSubmit()
    }
    JourneyTracker.current()?.trackMilestone('homepage_prompt_submitted', {
      promptLength: displayText.trim().length,
    })
    const analytics: Record<string, unknown> = isPromptStarterEnabled
      ? { starter_category: selectedStarterCategory ?? DEFAULT_STARTER_CATEGORY }
      : {}
    onStartBuilding({ analytics })
  }

  function selectCategory(category: StarterCategory): void {
    setSelectedStarterCategory(selectedStarterCategory === category ? null : category)
  }

  function handleTextareaChange(e: ChangeEvent<HTMLTextAreaElement>): void {
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
  }

  function handleTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (handleModifierEnterNewline(e, {
      currentValue: displayText,
      onValueChange: (nextValue: string): void => {
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
  }

  function handleTextareaFocus(): void {
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
  }

  function handleTextareaBlur(): void {
    setIsFocused(false)
    isUserTypingRef.current = false
  }

  function handleSpeechToggle(): void {
    logAnalytics('homepage.prompt.speech_toggled', { active: !isListening })
    toggleSpeech()
  }

  const typeText = useCallback(async (targetText: string): Promise<void> => {
    if (isLoading) return

    const validated = validateAndClampPrompt(targetText)
    const validatedText = validated.text

    if (displayText === validatedText) return

    if (isSafari()) {
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
      const displayedText = isRTL
        ? currentText.slice(currentText.length - i)
        : currentText.slice(0, i)
      setDisplayText(displayedText)
      await new Promise(resolve => setTimeout(resolve, typingSpeed))
    }

    // Then type the new text
    for (let i = 0; i <= validatedText.length; i++) {
      if (animationQueueRef.current[0] !== validatedText) return // Animation was interrupted
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
  }, [isLoading, displayText, setPromptText, isRTL])

  const bytesRemaining: number = MAX_PROMPT_BYTES - getByteLength(displayText)
  const isOverLimit: boolean = bytesRemaining < 0

  return {
    isTemplateSelectorEnabled,
    isTyping,
    displayText,
    isFocused,
    firstInputTimeRef,
    handleTextareaChange,
    handleTextareaKeyDown,
    handleTextareaFocus,
    handleTextareaBlur,
    handleStartBuilding,
    handleSpeechToggle,
    typeText,
    isListening,
    isSpeechSupported,
    onPromptBoxMouseEnter,
    onPromptBoxMouseLeave,
    bytesRemaining,
    isOverLimit,
    isPromptStarterEnabled,
    selectedStarterCategory,
    selectCategory,
  }
}
