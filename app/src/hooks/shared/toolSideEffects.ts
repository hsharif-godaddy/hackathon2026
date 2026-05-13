/**
 * Shared Tool Side Effects
 *
 * Extracted from WS ToolCallHandler and ToolResultHandler so both
 * WebSocket and SSE transports can trigger the same UI side effects
 * (Code view file-op state, todo-list updates, project-name sync).
 */

import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { trackHandoff, trackQuestionReceived } from '@/hooks/shared/initialBuildFunnel'
import { BRAND_DATA_UPDATED_EVENT } from '@/hooks/useBrandData'
import { logger } from '@/lib/request-context'
import { type FileOperationType, useCodeSyncStore } from '@/stores/useCodeSyncStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { useTodoListStore } from '@/stores/useTodoListStore'

const BRAND_UPDATE_TOOLS = new Set(['colorScheme', 'fontTheme', 'setProjectName', 'brandBook'])

function isBrandMemorySet(tool: { name: string; input?: any }): boolean {
  if (tool.name !== 'memorySet') return false
  const key = tool.input?.key
  return typeof key === 'string' && (key.startsWith('design.') || key.startsWith('brand.'))
}

// File operation tool names (mirrored from FileOperationHandler)
const FILE_OPERATION_TOOLS = new Set([
  'str_replace_based_edit_tool',
  'textEditor',
  'fileEdit',
  'write_file',
  'delete_file',
  'create_file',
])

function extractFilePaths(toolName: string, input: any): string[] {
  if (!input) return []
  if (toolName === 'fileEdit' && Array.isArray(input.operations)) {
    return input.operations
      .map((op: any) => op.path)
      .filter((path: any): path is string => typeof path === 'string')
  }
  const singlePath = input.path || input.file_path || null
  return singlePath ? [singlePath] : []
}

function getOperationType(toolName: string, input?: any): FileOperationType | null {
  if (toolName === 'str_replace_based_edit_tool' || toolName === 'textEditor') {
    const command = input?.command
    if (command === 'view') return null
    if (command === 'create') return 'create'
    return 'modify'
  }
  if (toolName === 'fileEdit') return 'modify'
  if (toolName === 'write_file' || toolName === 'create_file') return 'create'
  if (toolName === 'delete_file') return 'delete'
  return null
}

/**
 * Handle side effects when a tool_call event arrives.
 * Marks files as streaming in CodeSyncStore.
 */
export function handleToolCallSideEffects(tool: { name: string; input?: any }): void {
  if (!FILE_OPERATION_TOOLS.has(tool.name)) return

  const filePaths = extractFilePaths(tool.name, tool.input)
  if (filePaths.length === 0) return

  const operationType = getOperationType(tool.name, tool.input)
  if (!operationType) return

  const { markFileStreaming } = useCodeSyncStore.getState()
  for (const filePath of filePaths) {
    markFileStreaming(filePath, operationType)
  }
}

/**
 * Handle side effects when a tool_result event arrives.
 * Marks files as complete/error in CodeSyncStore, updates todo list,
 * and syncs project name.
 */
export async function handleToolResultSideEffects(
  tool: { name: string; input?: any; output?: any; result?: any; error?: any; is_error?: boolean },
  appId: string | null,
): Promise<void> {
  const hasError = tool.error || tool.is_error

  // File operation tracking
  if (FILE_OPERATION_TOOLS.has(tool.name)) {
    const filePaths = extractFilePaths(tool.name, tool.input)
    const operationType = getOperationType(tool.name, tool.input)
    if (filePaths.length > 0 && operationType) {
      const { markFileComplete, clearFileChange } = useCodeSyncStore.getState()
      for (const filePath of filePaths) {
        if (!hasError) {
          markFileComplete(filePath, operationType)
        } else {
          clearFileChange(filePath)
        }
      }
    }
  }

  // Todo list update
  if (tool.name === 'todoList' && !hasError) {
    try {
      const { updateFromToolCall } = useTodoListStore.getState()
      updateFromToolCall(tool.output ?? tool.result)
    } catch (error) {
      logger.error('toolSideEffects.todoList.update.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Project name sync
  if (tool.name === 'setProjectName' && !hasError && appId) {
    try {
      const { appFetch } = await import('@/lib/gasket-config')
      const { useSitesStore } = await import('@/stores/useSitesStore')
      const { useSiteStore } = await import('@/stores/useSiteStore')
      const { useDevelopPageStore } = await import('@/stores/useDevelopPageStore')
      const projectName = tool.input?.name

      if (!projectName) {
        logger.warn('toolSideEffects.setProjectName.missingName', { appId })
        return
      }

      const response = await appFetch(`/api/sites/${appId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName }),
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as { error?: string }
        const errorMessage = errorBody.error || `Control plane update failed: ${response.status}`
        logger.error('toolSideEffects.setProjectName.controlPlaneFailed', {
          appId, projectName, status: response.status,
        })
        useStreamingConversationStore.getState().markUpstreamError({
          message: `Failed to update project name: ${errorMessage}`,
          type: 'UPSTREAM_ERROR',
          statusCode: response.status,
        })
        return
      }

      try {
        useSiteStore.getState().updateSite(appId, { name: projectName })
        useSitesStore.getState().updateSite(appId, { name: projectName })

        const developState = useDevelopPageStore.getState()
        if (developState.site && developState.site.id === appId) {
          useDevelopPageStore.setState((state) => {
            if (state.site) {
              return { ...state, site: { ...state.site, name: projectName } }
            }
            return state
          })
        }
      } catch (storeError) {
        // Store writes succeeded on the control plane but failed locally — invalidate
        // so React Query refetches from the source of truth rather than stay stale.
        logger.error('toolSideEffects.setProjectName.storeSyncFailed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
        const queryClient = getQueryClient()
        if (queryClient) {
          await queryClient.invalidateQueries({ queryKey: ['site', appId] })
          await queryClient.invalidateQueries({ queryKey: ['sites'] })
        }
        useStreamingConversationStore.getState().markUpstreamError({
          message: `Failed to sync project name update: ${storeError instanceof Error ? storeError.message : String(storeError)}`,
          type: 'UPSTREAM_ERROR',
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('toolSideEffects.setProjectName.updateFailure', { appId, error: message })
      // A network-layer throw (dynamic import failure, fetch rejected) hits
      // this outer catch before the store-sync inner catch runs. Surface it
      // to the user so they see an error banner instead of silent failure.
      useStreamingConversationStore.getState().markUpstreamError({
        message: `Failed to update project name: ${message}`,
        type: 'UPSTREAM_ERROR',
      })
    }
  }

  // Brand data refresh (Brand Book UI)
  if (!hasError && (BRAND_UPDATE_TOOLS.has(tool.name) || isBrandMemorySet(tool))) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(BRAND_DATA_UPDATED_EVENT, { detail: { appId } }))
    }
  }

  // Initial build funnel: question received / handoff
  if (!hasError) {
    if (tool.name === 'askQuestion' || tool.name === 'suggestedResponse') {
      trackQuestionReceived()
    }
    if (tool.name === 'handoff') {
      trackHandoff()
    }
  }

  // Logo generation completed — surface the first logo so Brand Book UI can
  // preview it without refetching the whole manifest.
  const isLogoTool = !hasError &&
    (tool.name === 'media-logo__generate_logo' || tool.name === 'media-logo__edit_logo')
  if (isLogoTool && typeof window !== 'undefined') {
    try {
      const result = tool.output ?? tool.result
      const resultObj = typeof result === 'string' ? JSON.parse(result) : result
      const logos = resultObj?.structuredContent?.logos || resultObj?.logos
      if (logos?.[0]) {
        window.dispatchEvent(new CustomEvent('logo-generated', { detail: logos[0] }))
      } else {
        logger.warn('toolSideEffects.logoTool.noLogosInResult', { appId, toolName: tool.name })
      }
    } catch (error) {
      logger.warn('toolSideEffects.logoTool.resultParseFailed', {
        appId, toolName: tool.name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
