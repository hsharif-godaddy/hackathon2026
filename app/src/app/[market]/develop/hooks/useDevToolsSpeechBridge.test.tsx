/* eslint-disable react-hooks/rules-of-hooks -- renderHook callbacks trigger this rule */
/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { postMessageToIframe } from '@/utils/postMessage'
import { useDevToolsSpeechBridge } from './useDevToolsSpeechBridge'
import { IframeMessageType } from '../components/types'

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
}))

const startMock = vi.fn()
const stopMock = vi.fn()
const speechRecognitionState = {
  isListening: false,
  isSupported: true,
  transcript: '',
}
const lastSpeechOptions: { value: { language?: string } | undefined } = { value: undefined }

vi.mock('@/hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn((options: { language?: string } = {}) => {
    lastSpeechOptions.value = options
    return {
      isListening: speechRecognitionState.isListening,
      isSupported: speechRecognitionState.isSupported,
      transcript: speechRecognitionState.transcript,
      start: startMock,
      stop: stopMock,
      toggle: vi.fn(),
      resetTranscript: vi.fn(),
    }
  }),
}))

function setSpeechState(next: Partial<typeof speechRecognitionState>): void {
  Object.assign(speechRecognitionState, next)
}

describe('useDevToolsSpeechBridge', function useDevToolsSpeechBridgeTests() {
  beforeEach(function setupDom() {
    vi.clearAllMocks()
    speechRecognitionState.isListening = false
    speechRecognitionState.isSupported = true
    speechRecognitionState.transcript = ''
    lastSpeechOptions.value = undefined

    const iframe = document.createElement('iframe')
    iframe.id = 'preview-iframe'
    document.body.appendChild(iframe)
  })

  afterEach(function cleanupDom() {
    document.body.innerHTML = ''
  })

  it('broadcastSupport posts SPEECH_SUPPORT with supported=true when supported', function broadcastSupportTrue() {
    const { result } = renderHook(() => useDevToolsSpeechBridge())
    act(() => {
      result.current.broadcastSupport()
    })

    expect(postMessageToIframe).toHaveBeenCalledTimes(1)
    const [, message] = vi.mocked(postMessageToIframe).mock.calls[0]
    expect(message).toEqual({
      type: IframeMessageType.SPEECH_SUPPORT,
      data: { supported: true },
    })
  })

  it('broadcastSupport posts SPEECH_SUPPORT with supported=false when not supported', function broadcastSupportFalse() {
    setSpeechState({ isSupported: false })
    const { result } = renderHook(() => useDevToolsSpeechBridge())
    act(() => {
      result.current.broadcastSupport()
    })

    expect(postMessageToIframe).toHaveBeenCalledTimes(1)
    const [, message] = vi.mocked(postMessageToIframe).mock.calls[0]
    expect(message).toEqual({
      type: IframeMessageType.SPEECH_SUPPORT,
      data: { supported: false },
    })
  })

  it('broadcastSupport is a no-op when no preview iframe exists', function broadcastSupportNoIframe() {
    document.body.innerHTML = ''
    const { result } = renderHook(() => useDevToolsSpeechBridge())
    expect(() => {
      act(() => {
        result.current.broadcastSupport()
      })
    }).not.toThrow()
    expect(postMessageToIframe).not.toHaveBeenCalled()
  })

  it('handleStart calls start when supported', function handleStartSupported() {
    const { result } = renderHook(() => useDevToolsSpeechBridge())
    act(() => {
      result.current.handleStart()
    })
    expect(startMock).toHaveBeenCalledTimes(1)
  })

  it('handleStart does not call start when not supported', function handleStartUnsupported() {
    setSpeechState({ isSupported: false })
    const { result } = renderHook(() => useDevToolsSpeechBridge())
    act(() => {
      result.current.handleStart()
    })
    expect(startMock).not.toHaveBeenCalled()
  })

  it('handleStop calls stop only when bridge owns the listening session', function handleStopOwnership() {
    const { rerender, result } = renderHook(() => useDevToolsSpeechBridge())

    // Bare handleStop with isListening=false: no-op (bridge isn't the owner).
    act(() => {
      result.current.handleStop()
    })
    expect(stopMock).not.toHaveBeenCalled()

    // After handleStart and the wrapper transitioning isListening=true for
    // the bridge's owned session, handleStop calls the underlying stop.
    act(() => {
      result.current.handleStart()
    })
    setSpeechState({ isListening: true })
    rerender()
    act(() => {
      result.current.handleStop()
    })
    expect(stopMock).toHaveBeenCalledTimes(1)
  })

  it('broadcasts SPEECH_LISTENING when listening starts after handleStart', function broadcastListeningOnStart() {
    const { rerender, result } = renderHook(() => useDevToolsSpeechBridge())

    act(() => {
      result.current.handleStart()
    })
    vi.mocked(postMessageToIframe).mockClear()

    setSpeechState({ isListening: true })
    rerender()

    expect(postMessageToIframe).toHaveBeenCalledTimes(1)
    const [, message] = vi.mocked(postMessageToIframe).mock.calls[0]
    expect(message).toEqual({
      type: IframeMessageType.SPEECH_LISTENING,
      data: { listening: true },
    })
  })

  it('broadcasts SPEECH_LISTENING(false) when listening transitions back to idle', function broadcastListeningOnStop() {
    const { rerender, result } = renderHook(() => useDevToolsSpeechBridge())

    act(() => {
      result.current.handleStart()
    })
    setSpeechState({ isListening: true })
    rerender()
    vi.mocked(postMessageToIframe).mockClear()

    setSpeechState({ isListening: false })
    rerender()

    const listeningCalls = vi.mocked(postMessageToIframe).mock.calls.filter(
      ([, msg]) => (msg as { type: string }).type === IframeMessageType.SPEECH_LISTENING
    )
    expect(listeningCalls).toHaveLength(1)
    expect(listeningCalls[0][1]).toEqual({
      type: IframeMessageType.SPEECH_LISTENING,
      data: { listening: false },
    })
  })

  it('broadcasts SPEECH_TRANSCRIPT when transcript updates while listening and owned', function broadcastTranscript() {
    const { rerender, result } = renderHook(() => useDevToolsSpeechBridge())

    act(() => {
      result.current.handleStart()
    })
    setSpeechState({ isListening: true })
    rerender()
    vi.mocked(postMessageToIframe).mockClear()

    setSpeechState({ transcript: 'hello world' })
    rerender()

    const transcriptCalls = vi.mocked(postMessageToIframe).mock.calls.filter(
      ([, msg]) => (msg as { type: string }).type === IframeMessageType.SPEECH_TRANSCRIPT
    )
    expect(transcriptCalls).toHaveLength(1)
    expect(transcriptCalls[0][1]).toEqual({
      type: IframeMessageType.SPEECH_TRANSCRIPT,
      data: { transcript: 'hello world' },
    })
  })

  it('does not broadcast SPEECH_TRANSCRIPT when transcript is empty', function noBroadcastEmptyTranscript() {
    const { rerender, result } = renderHook(() => useDevToolsSpeechBridge())

    act(() => {
      result.current.handleStart()
    })
    setSpeechState({ isListening: true, transcript: '' })
    rerender()
    vi.mocked(postMessageToIframe).mockClear()

    setSpeechState({ transcript: '' })
    rerender()

    const transcriptCalls = vi.mocked(postMessageToIframe).mock.calls.filter(
      ([, msg]) => (msg as { type: string }).type === IframeMessageType.SPEECH_TRANSCRIPT
    )
    expect(transcriptCalls).toHaveLength(0)
  })

  it('passes language option through to useSpeechRecognition', function passesLanguageOption() {
    renderHook(() => useDevToolsSpeechBridge({ language: 'es-ES' }))
    expect(useSpeechRecognition).toHaveBeenCalledWith({ language: 'es-ES' })
    expect(lastSpeechOptions.value).toEqual({ language: 'es-ES' })
  })
})
