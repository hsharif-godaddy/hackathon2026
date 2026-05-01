export type TransportState = 'disconnected' | 'connected' | 'streaming' | 'error'

export interface TransportEvent {
  type: string
  data: Record<string, unknown>
  content?: string
  conversationId?: string
}

export interface ChatTransportCallbacks {
  onEvent: (event: TransportEvent) => void
  onStateChange: (state: TransportState) => void
  onError: (error: Error) => void
}

export interface SendMessageParams {
  content: string
  sessionId: string
  visualContext?: unknown
  aiEditContext?: unknown
  selectedAssets?: unknown[]
  todoListContext?: unknown
  isActionRequest?: boolean
  customContext?: unknown
  templateId?: string
  modelOverride?: string
  agentProfile?: string
  budgetServiceEnabled?: boolean
  subscriptionId?: string
  buildErrorContext?: { error: string; details: string; exitCode?: number } | null
}

export interface ChatTransport {
  readonly state: TransportState

  connect(appId: string, token: string, conversationId?: string): void
  updateToken(token: string): void
  disconnect(): void
  destroy(): void

  sendMessage(params: SendMessageParams): Promise<void>
  stopGeneration(): Promise<void>
  // conversationId is owned by the transport (set in connect) — callers pass
  // pagination params only.
  loadHistory(params?: { cursor?: string; limit?: number }): void

  emitGrantContext(payload: { grants: unknown[]; timestamp: number }): boolean

  on(callbacks: ChatTransportCallbacks): void
}
