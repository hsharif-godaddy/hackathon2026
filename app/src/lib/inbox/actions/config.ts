import type { ConversationActionConfig, ConversationActionName } from './types'

export const ACTION_REGISTRY: Record<ConversationActionName, ConversationActionConfig> = {
  resolve: {
    optimisticTransform: (c) => ({ ...c, status: 'resolved' }),
    canExecute: (c) => c.status === 'unresolved',
  },
  unresolve: {
    optimisticTransform: (c) => ({ ...c, status: 'unresolved' }),
    canExecute: (c) => c.status === 'resolved',
  },
}
