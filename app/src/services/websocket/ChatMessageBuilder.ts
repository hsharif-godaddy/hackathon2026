/**
 * ChatMessageBuilder
 *
 * Pure service for building AgentsAppChatMessage objects with proper context attachments.
 * Extracted from useStreamingWebSocket to improve testability and separation of concerns.
 */

import {
  buildContextAttachments,
  type BuildContextAttachmentsCustomContext,
  type ContextAttachment,
} from '@airo/shared/context-attachment'
import type { AgentsAppChatMessage, AgentsAppContext } from '@airo/shared/websocket'

import type { VisualContext } from '@/app/[market]/develop/components/visualContextCapture'

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

export type CustomContext = BuildContextAttachmentsCustomContext

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
  aiEditContexts?: AIEditContext[]
  selectedAssets?: TAsset[]
  todoListContext?: TodoContext
  buildErrorContext?: BuildError | null
  isActionRequest?: boolean
  customContext?: CustomContext
  templateId?: string
  modelOverride?: string
  market?: string
  /** Set by the rebuild page-selector "Build Page" button so the server can
   *  deterministically build this page from source (AIROBUILD-2104). */
  rebuildBuildPageSlug?: string
  /** FullStory replay-session token. Travels on context.metadata so the WS
   *  server can attach it to the Signals/OTel trace, mirroring the SSE request
   *  body field of the same name. */
  fullStorySessionId?: string
}

export class ChatMessageBuilder {
  // Cache timezone since it rarely changes during a session
  private static cachedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

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
        userTimezone: ChatMessageBuilder.cachedTimezone,
        ...(params.templateId && { templateId: params.templateId }),
        ...(params.modelOverride && { modelOverride: params.modelOverride }),
        ...(params.market && { market: params.market }),
        ...(params.rebuildBuildPageSlug && { rebuildBuildPageSlug: params.rebuildBuildPageSlug }),
        ...(params.fullStorySessionId && { fullStorySessionId: params.fullStorySessionId }),
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
    const attachments = buildContextAttachments(params) as ContextAttachment[]
    const context = this.buildRichContext(params, attachments)

    return {
      message: params.content,
      timestamp: new Date().toISOString(),
      context
    }
  }
}
