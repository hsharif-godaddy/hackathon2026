'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import SpeechRecognition, { useSpeechRecognition as useLibrarySpeechRecognition } from 'react-speech-recognition'

import { logger } from '@/lib/request-context'

// Ownership store.
//
// `react-speech-recognition` exposes a single global recognition session and
// every `useSpeechRecognition()` consumer reads the same `transcript` /
// `listening` state. With more than one consumer mounted on the same page
// (e.g. develop-page ChatInput + dev-tools Quick Edit bridge), each must
// only see state from a session it itself started. Ownership is the single
// piece of mutable state, encapsulated here behind a small store interface
// so the rest of the hook can stay pure and the boundary is auditable.
type OwnerToken = symbol

interface OwnershipStore {
  getOwner: () => OwnerToken | null
  setOwner: (token: OwnerToken | null) => void
  subscribe: (notify: () => void) => () => void
}

function createOwnershipStore(): OwnershipStore {
  let owner: OwnerToken | null = null
  const subscribers = new Set<() => void>()

  return {
    getOwner() { return owner },
    setOwner(token) {
      owner = token
      subscribers.forEach(function notifySubscriber(notify) { notify() })
    },
    subscribe(notify) {
      subscribers.add(notify)
      return () => { subscribers.delete(notify) }
    },
  }
}

const ownershipStore = createOwnershipStore()

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
 *
 * Multi-consumer safe: each hook instance is its own session. `start()`
 * claims global ownership; `isListening` / `transcript` / `interimTranscript`
 * only reflect library state while this consumer owns the session, and
 * `onTranscript` only fires for owned sessions. If an owning consumer
 * unmounts mid-session, the wrapper releases ownership and stops the
 * library so the orphaned recording doesn't keep going.
 */
export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn {
  const { language, onTranscript, continuous = true } = options

  // One token per hook instance, created lazily so it survives re-renders.
  const tokenRef = useRef<OwnerToken | null>(null)
  if (tokenRef.current === null) tokenRef.current = Symbol('speech-session')
  const token = tokenRef.current

  // SSR snapshot must always return the same value or React warns.
  const ssrSnapshot = useCallback(function getServerSnapshot(): OwnerToken | null { return null }, [])
  const owner = useSyncExternalStore(ownershipStore.subscribe, ownershipStore.getOwner, ssrSnapshot)
  const owns = owner !== null && owner === token

  const {
    transcript,
    interimTranscript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition,
    isMicrophoneAvailable,
  } = useLibrarySpeechRecognition()

  // Surface permission denials in Loki — `react-speech-recognition` flips
  // `isMicrophoneAvailable` to false when the user denies the prompt or
  // when no input device is present.
  const lastMicAvailableRef = useRef(true)
  useEffect(function logMicrophoneUnavailable() {
    if (lastMicAvailableRef.current && !isMicrophoneAvailable && owns) {
      logger.warn('speech-recognition.microphone-unavailable', {
        message: 'Microphone unavailable while owned session was active — likely permission denied or no device',
      })
    }
    lastMicAvailableRef.current = isMicrophoneAvailable
  }, [isMicrophoneAvailable, owns])

  const prevTranscriptRef = useRef('')
  useEffect(function fireOnTranscriptForOwnedSession() {
    if (!owns) return
    if (transcript && transcript !== prevTranscriptRef.current) {
      prevTranscriptRef.current = transcript
      onTranscript?.(transcript)
    }
  }, [transcript, owns, onTranscript])

  // If an owning consumer unmounts while a session is active, the library
  // would otherwise keep recording with no UI to stop it (and the user
  // would never see another mic-off transition). Release ownership and
  // stop the library on unmount.
  useEffect(function releaseOwnershipOnUnmount() {
    return function cleanupOwnership() {
      if (ownershipStore.getOwner() === token) {
        SpeechRecognition.stopListening()
        ownershipStore.setOwner(null)
      }
    }
  }, [token])

  const start = useCallback(function startListening() {
    ownershipStore.setOwner(token)
    resetTranscript()
    prevTranscriptRef.current = ''
    SpeechRecognition.startListening({ continuous, language: language || undefined })
  }, [continuous, language, resetTranscript, token])

  const stop = useCallback(function stopListening() {
    // Release ownership BEFORE telling the library to stop so `isListening`
    // flips to false synchronously and any broadcastListening effect (e.g.
    // dev-tools bridge → iframe) sends the final SPEECH_LISTENING(false) on
    // the same tick. If we waited for the library to drive the transition,
    // ownership would race the broadcast and the receiving consumer's mic
    // button would stay stuck in the "listening" state.
    if (ownershipStore.getOwner() === token) ownershipStore.setOwner(null)
    SpeechRecognition.stopListening()
  }, [token])

  const toggle = useCallback(function toggleListening() {
    if (owns && listening) {
      stop()
    } else {
      start()
    }
  }, [owns, listening, start, stop])

  return {
    isListening: owns && listening,
    isSupported: browserSupportsSpeechRecognition,
    transcript: owns ? transcript : '',
    interimTranscript: owns ? interimTranscript : '',
    start,
    stop,
    toggle,
    resetTranscript,
  }
}
