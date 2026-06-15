import type { SendMessageOptions } from '@/hooks/useStreamingWebSocket'
import type { QueuedMessage, QueuedSendPayload } from '@/stores/useStreamingConversationStore'

export function cloneQueueablePayload(opts: SendMessageOptions): QueuedSendPayload {
  const { visualContext: _visualContext, aiEditContext, aiEditContexts, selectedAssets, ...rest } = opts
  return {
    ...rest,
    ...(aiEditContext != null && {
      aiEditContext: { ...aiEditContext, screenshot: null },
    }),
    ...(aiEditContexts != null && {
      aiEditContexts: aiEditContexts.map((c) => ({ ...c, screenshot: null })),
    }),
    ...(selectedAssets != null && { selectedAssets: [...selectedAssets] }),
  }
}

export function queuedMessageToSendOptions(qm: QueuedMessage): SendMessageOptions {
  const { id: _id, enqueuedAt: _enqueuedAt, aiEditContext, aiEditContexts, selectedAssets, ...rest } = qm
  return {
    ...rest,
    ...(aiEditContext != null && { aiEditContext: { ...aiEditContext } }),
    ...(aiEditContexts != null && { aiEditContexts: aiEditContexts.map((c) => ({ ...c })) }),
    ...(selectedAssets != null && { selectedAssets: [...selectedAssets] }),
  }
}
