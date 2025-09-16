import { ServerOptions } from 'socket.io'
import type { Agent } from '../core/agent'
import type { AgentConfig } from '../core/types'

export interface WebSocketMessage {
  type: 'chat' | 'agentic' | 'tool_call' | 'error' | 'status'
  content?: string
  data?: Record<string, unknown>
  step?: number
  totalSteps?: number
}

export interface ChatMessageData {
  message: string
  useAgentic?: boolean
  files?: Array<{
    id: string
    originalName: string
    filename: string
    filepath: string
    size: number
    mimeType: string | null
    uploadedAt: string
  }>
}

export interface WebSocketServerConfig {
  // Agent configuration
  agent: Agent | AgentConfig
  
  // Server configuration
  cors?: {
    origin?: string | string[] | boolean
    methods?: string[]
  }
  
  // Streaming configuration
  maxSteps?: number
  
  // Usage data configuration
  includeUsageData?: boolean
  debugUsageData?: boolean
  
  // Event handlers (optional custom handlers)
  onConnection?: (socketId: string) => void
  onDisconnection?: (socketId: string) => void
  onMessageStart?: (socketId: string, message: string) => void
  onMessageComplete?: (socketId: string, result: {
    steps: number
    toolCount: number
    tools: string[]
    duration: string
  }) => void
  onError?: (socketId: string, error: Error, message?: string) => void
  
  // Socket.IO server options
  socketOptions?: Partial<ServerOptions>
}

export interface StreamingResult {
  content: string
  toolCalls: unknown[]
  usage?: unknown
}

export interface CompletionData {
  type: 'complete'
  content: string
  data: {
    totalSteps: number
    usage?: unknown
    toolCalls: unknown[]
  }
}
