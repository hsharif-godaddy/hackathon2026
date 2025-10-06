import { ServerOptions } from 'socket.io'
import type { Agent } from '../core/agent.js'
import type { AgentConfig } from '../core/types.js'

// Agent factory function type for dynamic agent creation
export type AgentFactory<TContext = Record<string, unknown>> = (context?: TContext) => Promise<Agent> | Agent

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
  agentId?: string // For multi-agent support - specify which agent to use
  context?: Record<string, unknown> // Generic context object for extensibility
  files?: Array<{
    id: string
    originalName: string
    filename: string
    size: number
    mimeType: string | null
    uploadedAt: string
  }>
}

export interface WebSocketServerConfig {
  // Agent configuration - single agent (legacy) or multiple agents
  agent?: Agent | AgentConfig
  agents?: Record<string, Agent | AgentConfig>
  agentFactories?: Record<string, AgentFactory<any>> // Dynamic agent creation with factories
  defaultAgent?: string // Default agent ID when using multiple agents
  
  // Context processing
  contextExtractor?: (rawContext: Record<string, unknown>) => Record<string, unknown> // Extract app-specific context
  filePathResolver?: (appId: string, uploadId: string, filename: string) => string // Resolve file paths for uploaded files
  
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
    agentId?: string
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
    agentId?: string
  }
}
