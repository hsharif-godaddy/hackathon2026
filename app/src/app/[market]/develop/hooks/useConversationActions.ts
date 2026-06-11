import { useMutation, useQueryClient } from '@tanstack/react-query'
import Growl from '@ux/growl'

import { useTranslations } from '@/hooks/useTranslations'
import { ACTION_REGISTRY } from '@/lib/inbox/actions/config'
import type { ConversationActionName, ConversationActionRequest } from '@/lib/inbox/actions/types'
import { queryKeys } from '@/lib/inbox/constants/queryKeys'
import { shipAnalyticsLog } from '@/lib/logging'
import { Conversation } from '@/types/inbox/local/conversation'
import { IntString, UuidString } from '@/types/inbox/local/core'
import { ConversationsResponse } from '@/types/inbox/remote/reamaze'

interface ActionMutationVariables {
  action: ConversationActionName
  conversationIds: IntString[]
}

interface OptimisticContext {
  previousList: [readonly unknown[], ConversationsResponse | undefined][]
  previousConversations: { key: readonly unknown[]; data: Conversation | undefined }[]
}

interface ActionHandle {
  execute: (conversationIds: IntString[]) => void
  isPending: boolean
  canExecute: (conversation: Conversation) => boolean
}

async function performConversationAction(params: ConversationActionRequest): Promise<void> {
  if (!params.brandId) {
    throw new Error('brandId is required to execute a conversation action')
  }
  if (!params.conversationIds.length) {
    throw new Error('At least one conversationId is required')
  }

  const response = await fetch('/api/inbox/conversations/actions', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brandId: params.brandId,
      conversationIds: params.conversationIds,
      action: params.action,
    }),
  })

  if (!response.ok) {
    const data: { error?: string } = await response.json().catch(() => ({}))
    throw new Error(data.error || `Action failed: ${response.status}`)
  }
}

export function useConversationActions(brandId: UuidString): Record<ConversationActionName, ActionHandle> {
  const queryClient = useQueryClient()
  const t = useTranslations()

  const mutation = useMutation({
    mutationFn: (variables: ActionMutationVariables) =>
      performConversationAction({
        brandId,
        conversationIds: variables.conversationIds,
        action: variables.action,
      }),
    onMutate: async (variables: ActionMutationVariables): Promise<OptimisticContext> => {
      const config = ACTION_REGISTRY[variables.action]
      const listPrefix = queryKeys.inboxConversationsByBrand(brandId)

      await queryClient.cancelQueries({ queryKey: listPrefix, exact: false })
      for (const id of variables.conversationIds) {
        await queryClient.cancelQueries({
          queryKey: queryKeys.inboxConversation(brandId, id),
        })
      }

      const previousList = queryClient.getQueriesData<ConversationsResponse>({
        queryKey: listPrefix,
        exact: false,
      })

      const previousConversations = variables.conversationIds.map((id: IntString) => ({
        key: queryKeys.inboxConversation(brandId, id),
        data: queryClient.getQueryData<Conversation>(
          queryKeys.inboxConversation(brandId, id),
        ),
      }))

      queryClient.setQueriesData<ConversationsResponse>(
        { queryKey: listPrefix, exact: false },
        (old: ConversationsResponse | undefined) => {
          if (!old) return old
          return {
            ...old,
            conversations: old.conversations.map((c: Conversation) =>
              variables.conversationIds.includes(c.id)
                ? config.optimisticTransform(c)
                : c,
            ),
          }
        },
      )

      for (const id of variables.conversationIds) {
        queryClient.setQueryData<Conversation>(
          queryKeys.inboxConversation(brandId, id),
          (old: Conversation | undefined) => old ? config.optimisticTransform(old) : old,
        )
      }

      return { previousList, previousConversations }
    },
    onSuccess: (_data: void, variables: ActionMutationVariables) => {
      Growl.addGrowlMessage({
        id: `inbox-action-${variables.action}-success`,
        title: t(`builder_inbox_action_${variables.action}_success`),
        emphasis: 'success',
        lifetime: 4000,
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.inboxConversationsByBrand(brandId),
        exact: false,
      })
      for (const id of variables.conversationIds) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.inboxConversation(brandId, id),
        })
      }
    },
    onError: (
      error: Error,
      variables: ActionMutationVariables,
      context: OptimisticContext | undefined,
    ) => {
      shipAnalyticsLog('inbox.action.failed', {
        action: variables.action,
        conversationIds: variables.conversationIds,
        brandId,
        error: error.message,
      })

      try {
        if (context?.previousList) {
          for (const [key, data] of context.previousList) {
            queryClient.setQueryData(key, data)
          }
        }
        if (context?.previousConversations) {
          for (const { key, data } of context.previousConversations) {
            queryClient.setQueryData(key, data)
          }
        }
      } catch (rollbackError) {
        shipAnalyticsLog('inbox.action.rollback.failed', {
          action: variables.action,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        })
        queryClient.invalidateQueries({
          queryKey: queryKeys.inboxConversationsByBrand(brandId),
          exact: false,
        })
      }

      Growl.addGrowlMessage({
        id: `inbox-action-${variables.action}-error`,
        title: t(`builder_inbox_action_${variables.action}_error`),
        emphasis: 'critical',
      })
    },
  })

  const makeHandle = (actionName: ConversationActionName): ActionHandle => ({
    execute: (conversationIds: IntString[]) => {
      if (!mutation.isPending) {
        mutation.mutate({ action: actionName, conversationIds })
      }
    },
    isPending: mutation.isPending && mutation.variables?.action === actionName,
    canExecute: ACTION_REGISTRY[actionName].canExecute,
  })

  return {
    resolve: makeHandle('resolve'),
    unresolve: makeHandle('unresolve'),
  }
}
