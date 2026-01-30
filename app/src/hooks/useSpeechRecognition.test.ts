import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useSpeechRecognition } from './useSpeechRecognition'

// Mock react-speech-recognition library
const mockStartListening = vi.fn()
const mockStopListening = vi.fn()
const mockResetTranscript = vi.fn()

vi.mock('react-speech-recognition', () => ({
  default: {
    startListening: (...args: unknown[]) => mockStartListening(...args),
    stopListening: () => mockStopListening(),
  },
  useSpeechRecognition: () => ({
    transcript: mockTranscriptState.transcript,
    interimTranscript: mockTranscriptState.interimTranscript,
    listening: mockTranscriptState.listening,
    resetTranscript: mockResetTranscript,
    browserSupportsSpeechRecognition: mockTranscriptState.browserSupportsSpeechRecognition,
  }),
}))

const mockTranscriptState = {
  transcript: '',
  interimTranscript: '',
  listening: false,
  browserSupportsSpeechRecognition: true,
}

describe('useSpeechRecognition', function hookTests() {
  beforeEach(function setup() {
    vi.clearAllMocks()
    mockTranscriptState.transcript = ''
    mockTranscriptState.interimTranscript = ''
    mockTranscriptState.listening = false
    mockTranscriptState.browserSupportsSpeechRecognition = true
  })

  afterEach(function cleanup() {
    vi.clearAllMocks()
  })

  it('should return isSupported true when browser supports speech recognition', function supportedBrowser() {
    mockTranscriptState.browserSupportsSpeechRecognition = true

    const { result } = renderHook(() => useSpeechRecognition())

    expect(result.current.isSupported).toBe(true)
  })

  it('should return isSupported false when browser does not support speech recognition', function unsupportedBrowser() {
    mockTranscriptState.browserSupportsSpeechRecognition = false

    const { result } = renderHook(() => useSpeechRecognition())

    expect(result.current.isSupported).toBe(false)
  })

  it('should call startListening when start is called', function startListening() {
    const { result } = renderHook(() => useSpeechRecognition())

    act(function triggerStart() {
      result.current.start()
    })

    expect(mockResetTranscript).toHaveBeenCalledOnce()
    expect(mockStartListening).toHaveBeenCalledWith({ continuous: true, language: undefined })
  })

  it('should call stopListening when stop is called', function stopListening() {
    const { result } = renderHook(() => useSpeechRecognition())

    act(function triggerStop() {
      result.current.stop()
    })

    expect(mockStopListening).toHaveBeenCalledOnce()
  })

  it('should toggle between start and stop', function toggleState() {
    mockTranscriptState.listening = false
    const { result, rerender } = renderHook(() => useSpeechRecognition())

    act(function firstToggle() {
      result.current.toggle()
    })

    expect(mockStartListening).toHaveBeenCalledOnce()

    // Simulate listening state change
    mockTranscriptState.listening = true
    rerender()

    act(function secondToggle() {
      result.current.toggle()
    })

    expect(mockStopListening).toHaveBeenCalledOnce()
  })

  it('should return listening state', function listeningState() {
    mockTranscriptState.listening = true

    const { result } = renderHook(() => useSpeechRecognition())

    expect(result.current.isListening).toBe(true)
  })

  it('should return transcript from library', function returnTranscript() {
    mockTranscriptState.transcript = 'hello world'

    const { result } = renderHook(() => useSpeechRecognition())

    expect(result.current.transcript).toBe('hello world')
  })

  it('should return interimTranscript from library', function returnInterimTranscript() {
    mockTranscriptState.interimTranscript = 'hel'

    const { result } = renderHook(() => useSpeechRecognition())

    expect(result.current.interimTranscript).toBe('hel')
  })

  it('should call onTranscript callback when transcript changes', function callOnTranscript() {
    const onTranscript = vi.fn()
    mockTranscriptState.transcript = ''

    const { rerender } = renderHook(() => useSpeechRecognition({ onTranscript }))

    // Simulate transcript change
    mockTranscriptState.transcript = 'hello'
    rerender()

    expect(onTranscript).toHaveBeenCalledWith('hello')
  })

  it('should not call onTranscript for same transcript', function avoidDuplicateCallback() {
    const onTranscript = vi.fn()
    mockTranscriptState.transcript = 'hello'

    const { rerender } = renderHook(() => useSpeechRecognition({ onTranscript }))

    // First render triggers callback
    expect(onTranscript).toHaveBeenCalledTimes(1)

    // Re-render with same transcript
    rerender()

    // Should not call again
    expect(onTranscript).toHaveBeenCalledTimes(1)
  })

  it('should pass continuous option to startListening', function continuousOption() {
    const { result } = renderHook(() => useSpeechRecognition({ continuous: false }))

    act(function triggerStart() {
      result.current.start()
    })

    expect(mockStartListening).toHaveBeenCalledWith({ continuous: false, language: undefined })
  })

  it('should pass language option to startListening', function languageOption() {
    const { result } = renderHook(() => useSpeechRecognition({ language: 'es-ES' }))

    act(function triggerStart() {
      result.current.start()
    })

    expect(mockStartListening).toHaveBeenCalledWith({ continuous: true, language: 'es-ES' })
  })

  it('should expose resetTranscript function', function exposeReset() {
    const { result } = renderHook(() => useSpeechRecognition())

    act(function triggerReset() {
      result.current.resetTranscript()
    })

    expect(mockResetTranscript).toHaveBeenCalledOnce()
  })
})
