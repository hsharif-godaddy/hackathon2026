/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IframeMessageType } from '@/app/develop/components/types'

const mockPostMessageToIframe = vi.fn()

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: (...args: unknown[]) => mockPostMessageToIframe(...args),
}))

import { broadcast, handle } from './iframeProcessingState'

function createMockIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.id = 'preview-iframe'
  document.body.appendChild(iframe)
  return iframe
}

describe('iframeProcessingState', function moduleTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  describe('#broadcast', function broadcastTests() {
    it('sends isProcessing true to the iframe', function sendTrue() {
      const iframe = createMockIframe()

      broadcast(true)

      expect(mockPostMessageToIframe).toHaveBeenCalledWith(iframe, {
        type: IframeMessageType.AGENT_PROCESSING_STATE,
        isProcessing: true,
      })
    })

    it('sends isProcessing false to the iframe', function sendFalse() {
      const iframe = createMockIframe()

      broadcast(false)

      expect(mockPostMessageToIframe).toHaveBeenCalledWith(iframe, {
        type: IframeMessageType.AGENT_PROCESSING_STATE,
        isProcessing: false,
      })
    })

    it('does nothing when no iframe exists in the DOM', function noIframe() {
      broadcast(true)

      expect(mockPostMessageToIframe).not.toHaveBeenCalled()
    })
  })

  describe('#handle', function handleTests() {
    describe('request-processing-state', function requestTests() {
      it('replies with current processing state when idle', function replyIdle() {
        const iframe = createMockIframe()

        const handled = handle('request-processing-state', iframe, false)

        expect(handled).toBe(true)
        expect(mockPostMessageToIframe).toHaveBeenCalledWith(iframe, {
          type: IframeMessageType.AGENT_PROCESSING_STATE,
          isProcessing: false,
        })
      })

      it('replies with current processing state when busy', function replyBusy() {
        const iframe = createMockIframe()

        const handled = handle('request-processing-state', iframe, true)

        expect(handled).toBe(true)
        expect(mockPostMessageToIframe).toHaveBeenCalledWith(iframe, {
          type: IframeMessageType.AGENT_PROCESSING_STATE,
          isProcessing: true,
        })
      })

      it('does not post when iframe is null', function noIframe() {
        const handled = handle('request-processing-state', null, true)

        expect(handled).toBe(true)
        expect(mockPostMessageToIframe).not.toHaveBeenCalled()
      })
    })

    describe('build-page-request while processing', function buildPageTests() {
      it('sends processing state when agent is busy', function sendWhileBusy() {
        const iframe = createMockIframe()

        handle('build-page-request', iframe, true)

        expect(mockPostMessageToIframe).toHaveBeenCalledWith(iframe, {
          type: IframeMessageType.AGENT_PROCESSING_STATE,
          isProcessing: true,
        })
      })

      it('does not send processing state when agent is idle', function skipWhenIdle() {
        createMockIframe()

        handle('build-page-request', document.getElementById('preview-iframe') as HTMLIFrameElement, false)

        expect(mockPostMessageToIframe).not.toHaveBeenCalled()
      })

      it('returns false so caller continues with existing build-page-request logic', function returnsFalse() {
        const iframe = createMockIframe()

        expect(handle('build-page-request', iframe, true)).toBe(false)
        expect(handle('build-page-request', iframe, false)).toBe(false)
      })
    })

    describe('unrelated message types', function unrelatedTests() {
      it('returns false for unknown types', function unknown() {
        const iframe = createMockIframe()

        expect(handle('TEXT_UPDATED', iframe, false)).toBe(false)
        expect(mockPostMessageToIframe).not.toHaveBeenCalled()
      })
    })
  })
})
