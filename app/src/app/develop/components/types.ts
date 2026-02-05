/**
 * Type Consolidation
 *
 * This file now re-exports canonical types from the streaming store to maintain
 * a single source of truth. Local types are only for UI-specific concerns.
 *
 * Store types (canonical & re-exported):
 *   - ToolCall, StreamSegment, ChatMessage, StreamingMessage
 *   - Conversation, WebSocketState, PlanItem
 *
 * UI-specific types (local only):
 *   - DevContext, ElementInfo, AiEditContext
 *   - ViewMode, PreviewViewMode, ChatTab, VisualContext
 */

// Re-export streaming store types as the canonical source
export type {
  ChatMessage,
  Conversation,
  PlanItem,
  StreamingMessage,
  StreamSegment,
  ToolCall,
  WebSocketState} from '@/stores/useStreamingConversationStore'

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
  // Image replacement specific fields
  isImageReplacement?: boolean
  imageInfo?: {
    type: 'img' | 'background' | 'contains-img' | 'sibling-img'
    currentUrl: string | null
  }
}

export enum ViewMode {
  PREVIEW = 'preview',
  CODE = 'code'
}

export enum PreviewViewMode {
  DESKTOP = 'desktop',
  TABLET = 'tablet',
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

export enum SettingsSection {
  PROJECT = 'project',
  DOMAIN = 'domain',
  BACKUPS = 'backups',
  SECURITY = 'security',
  TEAM = 'team',
  DATABASE = 'database',
  SECRETS = 'secrets',
  SOCIAL = 'social',
  VISUAL_SCAN = 'visualScan',
  ANALYTICS = 'analytics',
  MARKETING = 'marketing',
  LOGS = 'logs',
  CONVERSATIONS = 'conversations',
  FEEDBACK = 'feedback'
}

/**
 * Status configuration with label and type for UI display
 */
export const Status = {
  READY: { label: 'Ready', type: 'success' },
  PENDING: { label: 'Pending', type: 'info' },
  CRITICAL: { label: 'Error', type: 'critical' },
  AVAILABLE: { label: 'Available', type: 'success' },
  UNAVAILABLE: { label: 'Unavailable', type: 'critical' },
  INACTIVE: { label: 'Inactive', type: 'passive' }
} as const;

/**
 * Type for status values
 */
export type StatusValue = typeof Status[keyof typeof Status];

/**
 * Type for status keys
 */
export type StatusKey = keyof typeof Status;

export type { VisualContext } from './visualContextCapture'
