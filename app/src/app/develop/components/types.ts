/**
 * Type Consolidation
 *
 * This file now re-exports canonical types from the streaming store to maintain
 * a single source of truth. Local types are only for UI-specific concerns.
 *
 * Store types (canonical & re-exported):
 *   - ToolCall, StreamSegment, ChatMessage, StreamingMessage
 *   - Conversation, ErrorState, WebSocketState, PlanItem
 *
 * UI-specific types (local only):
 *   - DevContext, ElementInfo, AiEditContext
 *   - ViewMode, PreviewViewMode, ChatTab, VisualContext
 */

// Re-export streaming store types as the canonical source
export type {
  ToolCall,
  StreamSegment,
  ChatMessage,
  StreamingMessage,
  Conversation,
  ErrorState,
  WebSocketState,
  PlanItem
} from '@/stores/useStreamingConversationStore'

// All streaming-related types are now exported from the store above

export interface DevContext {
  fileName: string
  componentName: string
  lineNumber: number
}

export interface ElementInfo {
  tagName: string
  className: string
  id: string
  textContent: string
  selector: string
  dataId?: string
  rect: {
    top: number
    left: number
    width: number
    height: number
  }
  computedStyles: Record<string, string>
}

export interface AiEditContext {
  elementInfo: ElementInfo
  selector: string
  devContext: DevContext
  screenshot?: string | null
}

export enum ViewMode {
  PREVIEW = 'preview',
  CODE = 'code'
}

export enum PreviewViewMode {
  DESKTOP = 'desktop',
  MOBILE = 'mobile'
}

export enum ChatTab {
  APPS = 'apps',
  PREVIEW = 'preview',
  CHAT = 'chat',
  STYLES = 'styles',
  MEDIAS = 'medias',
  TODO = 'todo',
  HISTORY = 'history',
  SETTINGS = 'settings'
}

export type { VisualContext } from './visualContextCapture'
