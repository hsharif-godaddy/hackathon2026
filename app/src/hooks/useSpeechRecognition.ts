'use client'

import { useCallback, useEffect, useRef } from 'react'
import SpeechRecognition, { useSpeechRecognition as useLibrarySpeechRecognition } from 'react-speech-recognition'

export interface UseSpeechRecognitionOptions {
  /** BCP-47 language tag (e.g. 'en-US', 'es-ES'). Uses browser locale if not set. */
  language?: string
  onTranscript?: (transcript: string) => void
  continuous?: boolean
}

export interface UseSpeechRecognitionReturn {
  isListening: boolean
  isSupported: boolean
  transcript: string
  interimTranscript: string
  start: () => void
  stop: () => void
  toggle: () => void
  resetTranscript: () => void
}

/**
 * Custom hook for speech recognition using react-speech-recognition library.
 * Wraps the Web Speech API - no API keys required.
 */
export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn {
  const { language, onTranscript, continuous = true } = options

  const {
    transcript,
    interimTranscript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition,
  } = useLibrarySpeechRecognition()

  const prevTranscriptRef = useRef('')

  // Call onTranscript when transcript changes
  useEffect(function handleTranscriptChange() {
    if (transcript && transcript !== prevTranscriptRef.current) {
      prevTranscriptRef.current = transcript
      onTranscript?.(transcript)
    }
  }, [transcript, onTranscript])

  const start = useCallback(function startListening() {
    resetTranscript()
    prevTranscriptRef.current = ''
    SpeechRecognition.startListening({ continuous, language: language || undefined })
  }, [continuous, language, resetTranscript])

  const stop = useCallback(function stopListening() {
    SpeechRecognition.stopListening()
  }, [])

  const toggle = useCallback(function toggleListening() {
    if (listening) {
      stop()
    } else {
      start()
    }
  }, [listening, start, stop, resetTranscript])

  return {
    isListening: listening,
    isSupported: browserSupportsSpeechRecognition,
    transcript,
    interimTranscript,
    start,
    stop,
    toggle,
    resetTranscript,
  }
}
