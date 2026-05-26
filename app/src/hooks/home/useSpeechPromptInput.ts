'use client'

import { useEffect, useRef } from 'react'
import { useIntl } from 'react-intl'

import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { validateAndClampPrompt } from '@/lib/waf-validation'

interface UseSpeechPromptInputParams {
  displayText: string
  setDisplayText: (text: string) => void
  setPromptText: (text: string) => void
}

interface UseSpeechPromptInputReturn {
  isListening: boolean
  isSpeechSupported: boolean
  toggleSpeech: () => void
  stopSpeechForSubmit: () => void
}

export function useSpeechPromptInput({
  displayText,
  setDisplayText,
  setPromptText,
}: UseSpeechPromptInputParams): UseSpeechPromptInputReturn {
  const intl = useIntl()
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
  useEffect(function syncSpeechTranscript(): void {
    if (isListening && speechTranscript) {
      const baseText = textBeforeListeningRef.current
      const separator = baseText && !baseText.endsWith(' ') ? ' ' : ''
      const newText = baseText + separator + speechTranscript
      const validated = validateAndClampPrompt(newText)
      setDisplayText(validated.text)
      setPromptText(validated.text)
    }
  }, [isListening, speechTranscript, setPromptText])

  // Note: displayText is intentionally omitted from dependencies. We want to capture
  // the current displayText value only when listening starts, not re-run this effect
  // when displayText changes during listening (which would overwrite the captured value).
  useEffect(function captureTextOnListeningStart(): void {
    if (isListening) {
      textBeforeListeningRef.current = displayText
    }
  }, [isListening])

  function stopSpeechForSubmit(): void {
    // Clear ref before stopping to prevent race condition with captureTextOnListeningStart effect
    textBeforeListeningRef.current = ''
    stopSpeech()
    resetTranscript()
  }

  return {
    isListening,
    isSpeechSupported,
    toggleSpeech,
    stopSpeechForSubmit,
  }
}
