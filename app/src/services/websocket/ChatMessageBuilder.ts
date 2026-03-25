/**
 * ChatMessageBuilder
 *
 * Pure service for building AgentsAppChatMessage objects with proper context attachments.
 * Extracted from useStreamingWebSocket to improve testability and separation of concerns.
 */

import type { ContextAttachment } from '@airo/shared/context-attachment'
import type { AgentsAppChatMessage, AgentsAppContext } from '@airo/shared/websocket'

import type { VisualContext } from '@/app/develop/components/visualContextCapture'

export interface AIEditContext {
  [key: string]: unknown
}

export interface TodoContext {
  [key: string]: unknown
}

export interface BuildError {
  error: string
  details?: string
  exitCode?: number
}

export interface CustomContext {
  type?: string
  data?: unknown
  persistence?: 'save' | 'ephemeral'
  source?: string
  customAttachments?: ContextAttachment[]
  referencedFiles?: Array<{ path: string; content: string }>
}

export interface BuildMessageParams<
  TAsset extends { imageUrl?: string; thumbnailUrl?: string; videoUrl?: string } = {
    imageUrl?: string
    thumbnailUrl?: string
    videoUrl?: string
  }
> {
  content: string
  appId: string
  sessionId: string
  conversationId?: string | null
  visualContext?: VisualContext | null
  aiEditContext?: AIEditContext
  selectedAssets?: TAsset[]
  todoListContext?: TodoContext
  buildErrorContext?: BuildError | null
  isActionRequest?: boolean
  customContext?: CustomContext
}

export class ChatMessageBuilder {
  // Cache timezone since it rarely changes during a session
  private static cachedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  /**
   * Transform asset URLs to include https protocol
   * Generic function that preserves the input type while normalizing URL fields
   */
  private transformAssets<T extends { imageUrl?: string; thumbnailUrl?: string; videoUrl?: string }>(
    assets: T[] | undefined
  ): T[] {
    if (!assets || assets.length === 0) return []

    return assets.map(asset => ({
      ...asset,
      ...(asset.imageUrl && {
        imageUrl: asset.imageUrl.startsWith('//')
          ? `https:${asset.imageUrl}`
          : asset.imageUrl
      }),
      ...(asset.thumbnailUrl && {
        thumbnailUrl: asset.thumbnailUrl.startsWith('//')
          ? `https:${asset.thumbnailUrl}`
          : asset.thumbnailUrl
      }),
      ...(asset.videoUrl && {
        videoUrl: asset.videoUrl.startsWith('//')
          ? `https:${asset.videoUrl}`
          : asset.videoUrl
      })
    }))
  }

  /**
   * Build context attachments array from various context sources
   */
  private buildContextAttachments<TAsset extends { imageUrl?: string; thumbnailUrl?: string; videoUrl?: string }>(
    params: BuildMessageParams<TAsset>
  ): ContextAttachment[] {
    const attachments: ContextAttachment[] = []
    const timestamp = Date.now()

    if (params.aiEditContext) {
      attachments.push({
        type: 'ai_edit_context',
        data: params.aiEditContext,
        persistence: 'save',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: 'ai-edit-dialog'
        }
      })
    }

    if (params.visualContext) {
      attachments.push({
        type: 'visual_context',
        data: params.visualContext,
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: 'iframe-capture'
        }
      })
    }

    const transformedAssets = this.transformAssets(params.selectedAssets)
    if (transformedAssets.length > 0) {
      attachments.push({
        type: 'selected_assets',
        data: transformedAssets,
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: 'asset-manager'
        }
      })
    }

    if (params.buildErrorContext) {
      attachments.push({
        type: 'build_error',
        data: {
          error: params.buildErrorContext.error,
          details: params.buildErrorContext.details,
          exitCode: params.buildErrorContext.exitCode
        },
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: 'publish-failure'
        }
      })
    }

    if (params.todoListContext) {
      attachments.push({
        type: 'todo_list_context',
        data: params.todoListContext,
        persistence: 'save',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: 'todo-list-tool'
        }
      })
    }

    if (params.isActionRequest) {
      attachments.push({
        type: 'action_request',
        data: { instruction: '[Action Request] Execute this request immediately. Do not summarize previous work.' },
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: 'suggested_response'
        }
      })
    }

    if (params.customContext) {
      // Handle referenced files
      if (params.customContext.referencedFiles && params.customContext.referencedFiles.length > 0) {
        attachments.push({
          type: 'referenced_files',
          data: params.customContext.referencedFiles,
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp,
            source: 'file-reference'
          }
        })
      }

      // Handle custom attachments
      if (params.customContext.customAttachments && Array.isArray(params.customContext.customAttachments)) {
        attachments.push(...params.customContext.customAttachments)
      } else if (params.customContext.type && params.customContext.data) {
        attachments.push({
          type: params.customContext.type,
          data: params.customContext.data,
          persistence: params.customContext.persistence || 'ephemeral',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp,
            source: params.customContext.source || 'custom-context'
          }
        })
      }
    }

    return attachments
  }

  /**
   * Build rich context object with metadata and attachments
   */
  private buildRichContext<TAsset extends { imageUrl?: string; thumbnailUrl?: string; videoUrl?: string }>(
    params: BuildMessageParams<TAsset>,
    attachments: ContextAttachment[]
  ): AgentsAppContext {
    const richContext: AgentsAppContext = {
      metadata: {
        appId: params.appId,
        userId: 'current-user',
        sessionId: params.sessionId,
        userTimezone: ChatMessageBuilder.cachedTimezone
      },

      conversation: {
        conversationId: params.conversationId || undefined,
        maxMessages: 10,
        includeHistory: true
      },

      appContext: {
        includeDirectoryListing: true,
        includePackageInfo: true,
        includeDependencyStatus: true,
        maxDirectoryDepth: 3
      }
    }

    if (attachments.length > 0) {
      richContext.contextAttachments = attachments
    }

    return richContext
  }

  /**
   * Build complete chat message with context
   */
  build<TAsset extends { imageUrl?: string; thumbnailUrl?: string; videoUrl?: string }>(
    params: BuildMessageParams<TAsset>
  ): AgentsAppChatMessage {
    const attachments = this.buildContextAttachments(params)
    const context = this.buildRichContext(params, attachments)

    return {
      message: params.content,
      timestamp: new Date().toISOString(),
      context
    }
  }
}
