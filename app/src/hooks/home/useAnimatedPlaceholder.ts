'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useIntl } from 'react-intl'

import { isSafari } from '@/utils/browser'

interface UseAnimatedPlaceholderParams {
  isFocused: boolean
  displayText: string
  isRTL?: boolean
}

export function useAnimatedPlaceholder({
  isFocused,
  displayText,
  isRTL = false,
}: UseAnimatedPlaceholderParams): string {
  const intl = useIntl()
  const placeholders = useMemo(
    function buildShuffledPlaceholders(): string[] {
      return [
        intl.formatMessage({ id: 'builder_homepage_placeholder_1' }),
        intl.formatMessage({ id: 'builder_homepage_placeholder_2' }),
        intl.formatMessage({ id: 'builder_homepage_placeholder_3' }),
        intl.formatMessage({ id: 'builder_homepage_placeholder_4' }),
        intl.formatMessage({ id: 'builder_homepage_placeholder_5' }),
      ].sort(() => Math.random() - 0.5)
    }, [intl])
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
    let isDeleting = false

    const animatePlaceholder = (): void => {
      const currentText = placeholders[currentIndex]

      if (!isDeleting) {
        if (currentCharIndex <= currentText.length) {
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
  }, [isFocused, displayText, placeholders, isRTL])

  return animatedPlaceholder
}
