'use client'

import { type MutableRefObject, useEffect, useRef } from 'react'

import type { AiEditContext } from '@/app/[market]/develop/components/types'
import { ChatTab, MobileMode } from '@/app/[market]/develop/components/types'
import {
  extractNewPageRoute,
  handlePreviewRefresh,
  navigatePreviewToRoute,
  requestPreviewScreenshot,
} from '@/app/[market]/develop/components/utils'
import { handle as handleProcessingState } from '@/app/[market]/develop/utils/iframeProcessingState'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import type { SendMessageOptions } from '@/hooks/useStreamingWebSocket'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import type { AIEditContext } from '@/services/websocket/ChatMessageBuilder'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { RuntimeErrorData } from '@/types/runtime-error'
import type { BusEventType } from '@/utils/eventBus'
import { dispatch as dispatchBusEvent, off, on } from '@/utils/eventBus'
import { postMessageToIframe } from '@/utils/postMessage'

interface SpeechBridge {
  broadcastSupport: () => void
  handleStart: () => void
  handleStop: () => void
  handleIframeReady: () => void
}

interface IframeStateRef {
  scrollPosition?: { x: number; y: number }
  url?: string
}

export interface DevToolsBusBindingsDeps {
  appId: string
  isProcessingRef: MutableRefObject<boolean>
  pendingPublishSnapshotRef: MutableRefObject<boolean>
  lastIframeState: MutableRefObject<IframeStateRef>
  sendTextUpdate: (data: unknown) => void
  sendTextFix: (data: unknown) => void
  sendStyleUpdate: (data: unknown) => void
  sendUserRequestedFix: (errorData: RuntimeErrorData) => void
  sendEditModeMessage: (enabled: boolean) => void
  isEditModeEnabled: boolean
  setAiEditContext: (ctx: AiEditContext | null) => void
  addAiEditContext: (ctx: AiEditContext) => void
  setIsAssetManagerOpen: (open: boolean) => void
  setInputValue: (val: string) => void
  scheduleMicrotask: (fn: () => void) => void
  handleScreenshotUpload: (screenshot: string) => void
  handleEvalViewportScreenshot: (screenshot: string) => void
  handleAutoImportMediaSlot: (
    imageUrl: string,
    devContext: unknown,
    imageAlt: string | undefined,
    imageType: string | undefined,
    openEditor: boolean | undefined,
  ) => unknown
  speechBridge: SpeechBridge
  wsSend: (options: SendMessageOptions) => Promise<unknown> | unknown
}

const REGISTERED_TYPES: readonly BusEventType[] = [
  'TEXT_UPDATED',
  'TEXT_FIX_REQUESTED',
  'TEXT_FIX_ACCEPTED',
  'TEXT_FIX_REJECTED',
  'STYLE_UPDATED',
  'EDIT_WITH_AI',
  'REMOVE_SELECTION_FROM_PREVIEW',
  'CLEAR_AI_EDIT_CONTEXT',
  'SELECTIONS_CLEARED_BY_NAVIGATION',
  'QUICK_EDIT_SEND',
  'REPLACE_IMAGE',
  'SCROLL_POSITION_UPDATE',
  'VISUAL_CONTEXT_RESPONSE',
  'URL_CHANGE',
  'MESSAGE_COMPLETE',
  'error-fix-request',
  'error-platform-report',
  'runtime-errors-cycle',
  'error-fix-user-requested',
  'request-processing-state',
  'build-page-request',
  'build-error-fix-request',
  'SCREENSHOT_RESPONSE',
  'VIEWPORT_SCREENSHOT_RESPONSE',
  'OPEN_MEDIA_SLOT_DIALOG',
  'OPEN_IMAGE_EDITOR',
  'SPEECH_QUERY_SUPPORT',
  'SPEECH_START',
  'SPEECH_STOP',
  'AUTO_IMPORT_MEDIA_SLOT',
] as const

function getPreviewIframe(): HTMLIFrameElement | null {
  return document.getElementById('preview-iframe') as HTMLIFrameElement | null
}

/**
 * Wires every cross-iframe `postMessage` type the develop page consumes
 * onto the typed `eventBus`. The single useEffect registers all handlers
 * on mount and tears them down on unmount. Handlers read the latest deps
 * through a ref, so the effect doesn't re-run when individual callbacks
 * change identity — keeping the bus registrations stable across renders.
 *
 * The legacy `switch` is gone; only the `IFRAME_READY` handshake stays
 * outside the bus because origin/source validation depends on it.
 */
export function useDevToolsBusBindings(deps: DevToolsBusBindingsDeps): void {
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    const d = (): DevToolsBusBindingsDeps => depsRef.current

    on('TEXT_UPDATED', (m) => {
      const cur = d()
      logger.info('develop-page.text-updated-from-iframe', { appId: cur.appId })
      cur.sendTextUpdate(m.data)
    })

    on('TEXT_FIX_REQUESTED', (m) => {
      const cur = d()
      logger.info('develop-page.text-fix-requested-from-iframe', { appId: cur.appId })
      cur.sendTextFix(m.data)
    })

    on('TEXT_FIX_ACCEPTED', (m) => {
      logger.info('develop-page.text-fix.accepted', {
        appId: d().appId,
        oldLength: m.data.oldLength,
        newLength: m.data.newLength,
      })
    })

    on('TEXT_FIX_REJECTED', (m) => {
      logger.info('develop-page.text-fix.rejected', {
        appId: d().appId,
        oldLength: m.data.oldLength,
        newLength: m.data.newLength,
      })
    })

    on('STYLE_UPDATED', (m) => {
      const cur = d()
      logger.info('develop-page.style-updated-from-iframe', { appId: cur.appId })
      cur.sendStyleUpdate(m.data)
    })

    on('EDIT_WITH_AI', (m) => {
      const cur = d()
      const data = m.data
      // Bus payload (`BusAiEditContextPayload`) is structurally compatible
      // with the builder's `AiEditContext` for the fields the receiver
      // reads, but the bus shape has looser optionality on a few fields
      // (`id`, `devContext`) — cast at the boundary.
      if (useDevelopPageStore.getState().isMultiSelectEnabled && data.selectionNumber != null) {
        cur.addAiEditContext({ ...data, number: data.selectionNumber } as unknown as AiEditContext)
      } else {
        cur.setAiEditContext(data as unknown as AiEditContext)
      }
      useDevelopPageStore.getState().setActiveChatTab(ChatTab.CHAT)
      logger.info('develop-page.ai-edit-requested', { appId: cur.appId })
    })

    on('REMOVE_SELECTION_FROM_PREVIEW', (m) => {
      if (m.data.number != null) {
        useStreamingConversationStore.getState().removeAiEditContext(m.data.number)
      }
    })

    on('CLEAR_AI_EDIT_CONTEXT', () => {
      d().setAiEditContext(null)
    })

    on('SELECTIONS_CLEARED_BY_NAVIGATION', () => {
      d().setAiEditContext(null)
      useStreamingConversationStore.getState().clearAiEditContexts()
    })

    on('QUICK_EDIT_SEND', (m) => {
      const cur = d()
      const { prompt, selectionNumber } = m.data
      if (!prompt) return
      const iframe = getPreviewIframe()
      let aiEditContext: AiEditContext | null
      if (selectionNumber != null) {
        // Multi-select quick edit: send only this element's context, then clean it up
        const store = useStreamingConversationStore.getState()
        aiEditContext = store.aiEditContexts.find((c) => c.number === selectionNumber) ?? null
        store.removeAiEditContext(selectionNumber)
        if (iframe) postMessageToIframe(iframe, { type: 'REMOVE_SELECTION', data: { number: selectionNumber } })
      } else {
        aiEditContext = useStreamingConversationStore.getState().aiEditContext
        cur.setAiEditContext(null)
        if (iframe) postMessageToIframe(iframe, { type: 'CLEAR_SELECTION' })
      }
      // `AIEditContext` (websocket) is `Record<string, unknown>` and lacks
      // an explicit index signature on `AiEditContext`; double-cast through
      // unknown is the standard escape hatch.
      void cur.wsSend({ content: prompt, aiEditContext: aiEditContext as unknown as AIEditContext | null })
      logger.info('develop-page.quick-edit-sent', { appId: cur.appId })
    })

    on('REPLACE_IMAGE', (m) => {
      const cur = d()
      const replaceImageContext = {
        ...(m.data ?? {}),
        isImageReplacement: true,
      } as unknown as AiEditContext
      logger.info('develop-page.image-replace-requested', {
        appId: cur.appId,
        imageType: m.data?.imageInfo?.type,
      })
      cur.setAiEditContext(replaceImageContext)
      cur.setIsAssetManagerOpen(true)
    })

    on('SCROLL_POSITION_UPDATE', (m) => {
      d().lastIframeState.current.scrollPosition = {
        x: m.scrollX ?? 0,
        y: m.scrollY ?? 0,
      }
    })

    on('VISUAL_CONTEXT_RESPONSE', (m) => {
      if (m.context.scroll_position) {
        const ref = d().lastIframeState
        ref.current.scrollPosition = m.context.scroll_position
        ref.current.url = m.context.page
      }
    })

    on('URL_CHANGE', (m) => {
      d().lastIframeState.current.url = m.url
    })

    on('MESSAGE_COMPLETE', () => {
      const cur = d()
      // Capture message data now so the microtask uses a stable snapshot
      // rather than reading store state that could shift before it runs.
      const { messages: completedMessages } = useStreamingConversationStore.getState()
      const completedMessage = completedMessages[completedMessages.length - 1]
      const toolCallsAtCompletion = completedMessage?.role === 'assistant'
        ? (completedMessage.toolCalls ?? [])
        : []

      cur.scheduleMicrotask(() => {
        const newPageRoute = toolCallsAtCompletion.length
          ? extractNewPageRoute(toolCallsAtCompletion)
          : null

        if (newPageRoute) {
          logger.info('develop-page.preview.navigate-to-new-page', { appId: cur.appId, route: newPageRoute })
          cur.lastIframeState.current.url = newPageRoute
          cur.lastIframeState.current.scrollPosition = { x: 0, y: 0 }
          requestPreviewScreenshot()
          navigatePreviewToRoute(newPageRoute)
        } else {
          handlePreviewRefresh({ lastIframeState: cur.lastIframeState })
        }
      })
    })

    on('error-fix-request', (m) => {
      const cur = d()
      // Auto-sent by AiroErrorBoundary on every caught error. Purely
      // informational: forward to the agents' runtime-error buffer so the
      // post-stream validator can pick it up on the next turn.
      const errorData = m.errorData
      logger.info('develop-page.error-fix-request', {
        appId: cur.appId,
        errorName: errorData.name,
        errorMessage: errorData.message,
        hasStack: !!errorData.stack,
        hasComponentStack: !!errorData.componentStack,
        cycleId: errorData.cycleId,
      })
      void (async () => {
        try {
          const url = await buildDynamicApiUrl('runtime-errors', cur.appId)
          await agentFetch(url, {
            method: 'POST',
            siteId: cur.appId,
            body: JSON.stringify(errorData),
          })
        } catch (err) {
          logger.warn('develop-page.runtime-error.forward.failed', {
            appId: cur.appId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })()
    })

    on('error-platform-report', (m) => {
      const cur = d()
      // Sent when error originated inside dev-tools platform code. We log
      // for Loki visibility but do NOT forward to the runtime-error buffer
      // — the agent can't fix platform files. The bus contract requires
      // `name`/`message` on `errorData`, so the malformed-payload guard
      // only fires if a sender violates the contract at runtime.
      const raw = m.errorData
      if (typeof raw?.message !== 'string' || typeof raw?.name !== 'string') {
        logger.warn('develop-page.error-platform-report.malformed', {
          appId: cur.appId,
          receivedType: typeof raw,
          receivedKeys: raw && typeof raw === 'object' ? Object.keys(raw as object).join(',') : undefined,
        })
        return
      }
      logger.warn('develop-page.error-platform-report', {
        appId: cur.appId,
        errorName: raw.name,
        errorMessage: raw.message,
        hasStack: !!raw.stack,
        hasComponentStack: !!raw.componentStack,
        cycleId: raw.cycleId,
      })
    })

    on('runtime-errors-cycle', (m) => {
      const cur = d()
      const cycleId = m.cycleId
      if (!Number.isFinite(cycleId)) return
      void (async () => {
        try {
          const url = await buildDynamicApiUrl('runtime-errors/cycle', cur.appId)
          await agentFetch(url, {
            method: 'POST',
            siteId: cur.appId,
            body: JSON.stringify({ cycleId }),
          })
        } catch (err) {
          logger.warn('develop-page.runtime-errors-cycle.forward.failed', {
            appId: cur.appId,
            cycleId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })()
    })

    on('error-fix-user-requested', (m) => {
      const cur = d()
      if (cur.isProcessingRef.current) {
        logger.info('develop-page.error-fix-user-requested.skipped-processing', { appId: cur.appId })
        return
      }
      const errorData = m.errorData
      logger.info('develop-page.error-fix-user-requested', {
        appId: cur.appId,
        errorName: errorData.name,
        errorMessage: errorData.message,
      })
      cur.sendUserRequestedFix(errorData)
    })

    on('request-processing-state', () => {
      const cur = d()
      handleProcessingState('request-processing-state', getPreviewIframe(), cur.isProcessingRef.current)
    })

    on('build-page-request', (m) => {
      const cur = d()
      if (cur.isProcessingRef.current) {
        logger.info('develop-page.build-page-request.skipped-processing', { appId: cur.appId })
        handleProcessingState('build-page-request', getPreviewIframe(), true)
        return
      }
      logger.info('develop-page.build-page-request', {
        appId: cur.appId,
        pathToBuild: m.pathToBuild,
      })
      const messageContent = `The page at path ${m.pathToBuild} doesn't exist yet, please build it with appropriate content.`
      cur.setInputValue(messageContent)
      cur.scheduleMicrotask(() => {
        void cur.wsSend({ content: messageContent, aiEditContext: null })
      })
    })

    on('build-error-fix-request', (m) => {
      const cur = d()
      if (cur.isProcessingRef.current) {
        logger.info('develop-page.build-error-fix-request.skipped-processing', { appId: cur.appId })
        return
      }
      logger.info('develop-page.build-error-fix-request', {
        appId: cur.appId,
        errorMessage: m.errorMessage,
        hasDetails: !!m.errorDetails,
        exitCode: m.exitCode,
      })
      const messageContent = 'Please analyze and fix this publish failure.'
      cur.setInputValue(messageContent)
      cur.scheduleMicrotask(() => {
        void cur.wsSend({
          content: messageContent,
          aiEditContext: null,
          isActionRequest: false,
          customContext: {
            type: 'build_error',
            data: {
              error: m.errorMessage,
              details: m.errorDetails,
              exitCode: m.exitCode,
            },
            persistence: 'ephemeral',
            source: 'publish-failure',
          },
        })
      })
    })

    on('SCREENSHOT_RESPONSE', (m) => {
      d().handleScreenshotUpload(m.screenshot)
    })

    on('VIEWPORT_SCREENSHOT_RESPONSE', (m) => {
      const cur = d()
      if (cur.pendingPublishSnapshotRef.current) {
        // PreviewPane handles the publish path; reset boolean via microtask
        // so this handler's guard fires before the reset settles.
        void Promise.resolve().then(() => { cur.pendingPublishSnapshotRef.current = false })
      } else {
        cur.handleEvalViewportScreenshot(m.screenshot)
      }
    })

    on('OPEN_MEDIA_SLOT_DIALOG', (m) => {
      const cur = d()
      if (!cur.appId) return
      useMediaSlotDialogStore.getState().navigateToSlot(m.slotName)
      const develop = useDevelopPageStore.getState()
      develop.setActiveChatTab(ChatTab.MEDIAS)
      if (develop.isMobile) {
        develop.handleMobileModeChange(MobileMode.TOOLS)
      }
    })

    on('OPEN_IMAGE_EDITOR', (m) => {
      const cur = d()
      if (!cur.appId) return
      useMediaSlotDialogStore.getState().navigateToSlot(m.slotName, { openEditor: true })
      const develop = useDevelopPageStore.getState()
      develop.setActiveChatTab(ChatTab.MEDIAS)
      if (develop.isMobile) {
        develop.handleMobileModeChange(MobileMode.TOOLS)
      }
    })

    on('SPEECH_QUERY_SUPPORT', () => {
      d().speechBridge.broadcastSupport()
    })

    on('SPEECH_START', () => {
      d().speechBridge.handleStart()
    })

    on('SPEECH_STOP', () => {
      d().speechBridge.handleStop()
    })

    on('AUTO_IMPORT_MEDIA_SLOT', (m) => {
      const cur = d()
      if (!cur.appId) return
      void cur.handleAutoImportMediaSlot(m.imageUrl, m.devContext, m.imageAlt, m.imageType, m.openEditor)
    })

    const handleMessage = (event: MessageEvent): void => {
      // Handle messages from iframe or from same window (for websocket events)
      const iframe = getPreviewIframe()
      const isFromIframe = iframe && event.source === iframe.contentWindow
      const isFromSameWindow = event.source === window

      if (!isFromIframe && !isFromSameWindow) return

      if (dispatchBusEvent(event.data)) return

      // IFRAME_READY stays outside the bus: origin validation depends on it
      // and we rebroadcast edit-mode/speech-support state on every (re)ready.
      if (event.data?.type === 'IFRAME_READY') {
        const cur = d()
        cur.sendEditModeMessage(cur.isEditModeEnabled)
        cur.speechBridge.handleIframeReady()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      for (const t of REGISTERED_TYPES) off(t)
    }
  }, [])
}
