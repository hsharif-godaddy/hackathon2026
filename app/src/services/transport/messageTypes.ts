/**
 * Transport-neutral chat-message contract types (relocated from the WebSocket stack for AIROBUILD-2631).
 */

import type { BuildContextAttachmentsCustomContext } from '@airo/shared/context-attachment'

import type { AssetManagerItem } from '@/app/[market]/develop/components/chat/AssetTypes'
import type { VisualContext } from '@/app/[market]/develop/components/visualContextCapture'

export type AIEditContext = Record<string, unknown>

export type TodoContext = Record<string, unknown>

export type CustomContext = BuildContextAttachmentsCustomContext

/**
 * Options for sending a message through the chat transport
 */
export interface SendMessageOptions {
  /** The message content (required) */
  content: string

  /** Visual context captured from iframe preview */
  visualContext?: VisualContext | null

  /** AI edit context for code modifications */
  aiEditContext?: AIEditContext | null

  /** Multiple AI edit contexts (flag: appbuilder-multi-element-select) */
  aiEditContexts?: AIEditContext[]

  /** Selected assets (images/videos) to attach */
  selectedAssets?: AssetManagerItem[]

  /** TODO list context for planning */
  todoListContext?: TodoContext

  /** Whether this is an action request (vs conversational) */
  isActionRequest?: boolean

  /** User skipped an askQuestion NBA — dismiss chips without executing the plan */
  askQuestionSkipped?: boolean

  /** Custom context for extensions */
  customContext?: CustomContext

  /** Rebuild page-selector "Build Page" slug — server builds it from source (AIROBUILD-2104) */
  rebuildBuildPageSlug?: string

  /** Template ID for custom initial agent prompts */
  templateId?: string
  /** Internal-only "start-as" override (?agent=). Server honors it only when the JWT carries agentStartOverrideEnabled. */
  overrideAgentId?: string

  /** Design kit slug for initial build (AIROBUILD-2072) */
  designKitSlug?: string

  /** Per-project model override (from model selector in settings) */
  modelOverride?: string

  /** Name of file uploaded via HTTP to the agent (displayed below message) */
  uploadedFileName?: string

  /** Automation job ID when this message is an automation run — agent writes a run summary on completion */
  automationId?: string
}
