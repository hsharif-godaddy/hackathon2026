'use client'

import { useCallback, useEffect, useRef } from 'react'

import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { postMessageToIframe } from '@/utils/postMessage'
import { IframeMessageType } from '../components/types'

interface UseDevToolsSpeechBridgeOptions {
  language?: string
}

interface UseDevToolsSpeechBridgeReturn {
  /** Broadcast SPEECH_SUPPORT to the iframe. Call from SPEECH_QUERY_SUPPORT
   *  message handler. */
  broadcastSupport: () => void
  /** Handle IFRAME_READY from the iframe. Stops any orphaned session this
   *  bridge owns (the originating iframe was just torn down by a preview
   *  reload or route change) and re-broadcasts SPEECH_SUPPORT to the new
   *  iframe so the bridge picks up support state on first hover. */
  handleIframeReady: () => void
  /** Handle SPEECH_START from the iframe — start the parent's recognition. */
  handleStart: () => void
  /** Handle SPEECH_STOP from the iframe — stop the parent's recognition. */
  handleStop: () => void
}

function getPreviewIframe(): HTMLIFrameElement | null {
  if (typeof document === 'undefined') return null
  return document.getElementById('preview-iframe') as HTMLIFrameElement | null
}

/**
 * Bridges the parent app's speech recognition to the dev-tools Quick Edit bar.
 *
 * The dev-tools package can't install `react-speech-recognition`, so the
 * parent owns the recognition instance and the iframe drives it via
 * postMessage. The Web Speech API binds to the document that calls
 * `start()`, so the parent prompts for mic permission once and the iframe
 * just renders the resulting state.
 *
 * `useSpeechRecognition` itself scopes `isListening` / `transcript` to
 * whichever consumer claimed the session, so this bridge naturally only
 * broadcasts state from sessions started here — ChatInput's mic button on
 * the same page doesn't bleed through.
 */
export function useDevToolsSpeechBridge(
  options: UseDevToolsSpeechBridgeOptions = {}
): UseDevToolsSpeechBridgeReturn {
  const { language } = options
  const { isListening, isSupported, transcript, start, stop } = useSpeechRecognition({ language })

  // Only broadcast on transitions, not on mount. The iframe pulls initial
  // support state via SPEECH_QUERY_SUPPORT; an unsolicited SPEECH_LISTENING
  // (false) on every mount is noise.
  const lastBroadcastListeningRef = useRef<boolean>(isListening)
  useEffect(function broadcastListening() {
    if (lastBroadcastListeningRef.current === isListening) return
    lastBroadcastListeningRef.current = isListening
    const iframe = getPreviewIframe()
    if (!iframe) return
    postMessageToIframe(iframe, {
      type: IframeMessageType.SPEECH_LISTENING,
      data: { listening: isListening }
    })
  }, [isListening])

  useEffect(function broadcastTranscript() {
    if (!isListening || !transcript) return
    const iframe = getPreviewIframe()
    if (!iframe) return
    postMessageToIframe(iframe, {
      type: IframeMessageType.SPEECH_TRANSCRIPT,
      data: { transcript }
    })
  }, [isListening, transcript])

  const broadcastSupport = useCallback(function broadcastSupport() {
    const iframe = getPreviewIframe()
    if (!iframe) return
    postMessageToIframe(iframe, {
      type: IframeMessageType.SPEECH_SUPPORT,
      data: { supported: isSupported }
    })
  }, [isSupported])

  const handleStart = useCallback(function handleStart() {
    if (!isSupported) return
    start()
  }, [isSupported, start])

  const handleStop = useCallback(function handleStop() {
    // Only stop if we currently own the session. `isListening` from the
    // wrapper already filters by ownership, so a SPEECH_STOP that arrives
    // when ChatInput owns the session won't cancel its recording.
    if (!isListening) return
    stop()
  }, [isListening, stop])

  const handleIframeReady = useCallback(function handleIframeReady() {
    // A new IFRAME_READY means the originating iframe was just replaced
    // (preview reload, route change). If we still own a session it's an
    // orphan with no UI to stop it — kill it before the new iframe gets
    // its support state.
    if (isListening) stop()
    broadcastSupport()
  }, [isListening, stop, broadcastSupport])

  return { broadcastSupport, handleIframeReady, handleStart, handleStop }
}
