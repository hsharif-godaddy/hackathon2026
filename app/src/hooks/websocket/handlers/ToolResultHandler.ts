/**
 * Tool Result Handler
 *
 * Handles tool_result messages containing tool execution results.
 * Updates tool call segment with result and updates persistent todo list if applicable.
 */

import { logger } from '@/lib/request-context'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { useTodoListStore } from '@/stores/useTodoListStore'
import { fileOperationHandler } from './FileOperationHandler'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ToolResultHandler implements MessageHandler {
  readonly type = 'tool_result'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    if (data.data?.tool) {
      // Flush any buffered deltas before processing result
      context.actions.flushToolDeltaBufferImmediate()

      const tool = data.data.tool as any
      const hasError = tool.error || tool.is_error

      const toolCall: ToolCall = {
        id: tool.id,
        name: tool.name,
        input: tool.input || {},
        result: tool.output || tool.result,
        error: tool.error,
        status: hasError ? 'error' : 'completed',
        startTime: tool.startTime,
        endTime: Date.now(),
      }

      context.helpers.sendToolImpression(tool.name)
      context.actions.addToolResultSegment(toolCall)

      // Track file operations for Code view synchronization
      await fileOperationHandler.handle(data)

      // Update persistent todo list if this is a todoList tool
      if (tool.name === 'todoList' && !hasError) {
        try {
          const { updateFromToolCall } = useTodoListStore.getState()
          updateFromToolCall(toolCall.result)
        } catch (error) {
          logger.error('websocket.todo-list.update.failure', {
            appId: context.currentAppId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Update control plane and stores when setProjectName completes successfully
      if (tool.name === 'setProjectName' && !hasError && context.currentAppId) {
        try {
          const { appFetch } = await import('@/lib/gasket-config')
          const { useSitesStore } = await import('@/stores/useSitesStore')
          const { useSiteStore } = await import('@/stores/useSiteStore')
          const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore')
          const projectName = tool.input?.name
          
          if (!projectName) {
            logger.warn('websocket.setProjectName.missingName', {
              appId: context.currentAppId,
              message: 'No project name provided in tool input'
            })
            return
          }

          // Update control plane first (for persistence)
          const response = await appFetch(`/api/sites/${context.currentAppId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: projectName }),
          })

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            const errorMessage = errorData.error || `Control plane update failed: ${response.status}`
            
            context.actions.markUpstreamError({
              message: `Failed to update project name: ${errorMessage}`,
              type: 'UPSTREAM_ERROR',
              statusCode: response.status
            })
            
            logger.error('websocket.setProjectName.controlPlaneFailed', {
              appId: context.currentAppId,
              projectName,
              status: response.status,
              error: errorMessage,
            })
            
            throw new Error(errorMessage)
          }

          logger.info('websocket.setProjectName.controlPlaneUpdated', {
            appId: context.currentAppId,
            projectName,
          })

          // Wrap store updates in try-catch for recovery
          try {
            // Update stores in consistent order: useSiteStore → useSitesStore → useDevelopPageStore
            useSiteStore.getState().updateSite(context.currentAppId, { name: projectName })
            useSitesStore.getState().updateSite(context.currentAppId, { name: projectName })
            
            const developState = useDevelopPageStore.getState()
            if (developState.site && developState.site.id === context.currentAppId) {
              useDevelopPageStore.setState((state) => {
                if (state.site) {
                  return {
                    ...state,
                    site: {
                      ...state.site,
                      name: projectName
                    }
                  }
                }
                return state
              })
            }
            
            logger.info('websocket.setProjectName.storesUpdated', {
              appId: context.currentAppId,
              projectName,
            })
          } catch (storeError) {
            // Store update failed - provide user feedback and trigger refetch
            const errorMessage = storeError instanceof Error ? storeError.message : String(storeError)
            
            context.actions.markUpstreamError({
              message: `Failed to sync project name update: ${errorMessage}`,
              type: 'UPSTREAM_ERROR',
              statusCode: 500
            })
            
            logger.error('websocket.setProjectName.storeUpdateFailed', {
              appId: context.currentAppId,
              projectName,
              error: errorMessage,
              recovery: 'Triggering refetch from control plane'
            })
            
            // Trigger refetch to recover from control plane
            const { getQueryClient } = await import('@/components/providers/QueryClientProvider')
            const queryClient = getQueryClient()
            if (queryClient) {
              await queryClient.invalidateQueries({
                queryKey: ['site', context.currentAppId]
              })
              await queryClient.invalidateQueries({
                queryKey: ['sites']
              })
              
              logger.info('websocket.setProjectName.recoveryTriggered', {
                appId: context.currentAppId,
                message: 'Cache invalidated, UI will refetch from control plane'
              })
            }
          }
        } catch (error) {
          logger.error('websocket.setProjectName.updateFailure', {
            appId: context.currentAppId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  }
}
