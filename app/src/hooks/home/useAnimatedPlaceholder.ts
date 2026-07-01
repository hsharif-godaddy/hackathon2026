'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useIntl } from 'react-intl'

import { isSafari } from '@/utils/browser'

interface UseAnimatedPlaceholderParams {
  isFocused: boolean
  displayText: string
  isRTL?: boolean
  /** Category-specific examples (i18n id + English fallback); overrides the default placeholders when provided and non-empty. */
  examples?: readonly { id: string; defaultMessage: string }[]
}

export function useAnimatedPlaceholder({
  isFocused,
  displayText,
  isRTL = false,
  examples,
}: UseAnimatedPlaceholderParams): string {
  const intl = useIntl()
  const placeholders = useMemo(
    function buildShuffledPlaceholders(): string[] {
      const source: string[] = examples && examples.length > 0
        ? examples.map((example) => intl.formatMessage({ id: example.id, defaultMessage: example.defaultMessage }))
        : [
            intl.formatMessage({ id: 'builder_homepage_placeholder_1' }),
            intl.formatMessage({ id: 'builder_homepage_placeholder_2' }),
            intl.formatMessage({ id: 'builder_homepage_placeholder_3' }),
            intl.formatMessage({ id: 'builder_homepage_placeholder_4' }),
            intl.formatMessage({ id: 'builder_homepage_placeholder_5' }),
          ]
      return [...source].sort(() => Math.random() - 0.5)
    }, [intl, examples])
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState('')
  const placeholderTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isFocused || displayText.trim().length > 0) {
      setAnimatedPlaceholder('')
      return
    }

    // Safari: show static first placeholder without animation
    if (isSafari()) {
      setAnimatedPlaceholder(placeholders[0])
      return
    }

    let currentIndex = 0
    let currentCharIndex = 0

    const animatePlaceholder = (): void => {
      const currentText = placeholders[currentIndex]

      if (currentCharIndex <= currentText.length) {
        const displayedText = isRTL
          ? currentText.slice(currentText.length - currentCharIndex)
          : currentText.slice(0, currentCharIndex)
        setAnimatedPlaceholder(displayedText)
        currentCharIndex++
        placeholderTimerRef.current = setTimeout(animatePlaceholder, 50)
      } else {
        // Fully typed: dwell, then clear in one step (no backspace animation) and
        // advance to the next example.
        placeholderTimerRef.current = setTimeout(() => {
          setAnimatedPlaceholder('')
          currentIndex = (currentIndex + 1) % placeholders.length
          currentCharIndex = 0
          placeholderTimerRef.current = setTimeout(animatePlaceholder, 500)
        }, 2000)
      }
    }

    animatePlaceholder()

    return () => {
      if (placeholderTimerRef.current) {
        clearTimeout(placeholderTimerRef.current)
      }
    }
  }, [isFocused, displayText, placeholders, isRTL])

  return animatedPlaceholder
}
