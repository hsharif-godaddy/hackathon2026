export type TransportState = 'disconnected' | 'connected' | 'streaming' | 'error'

export interface TransportEvent {
  type: string
  data: Record<string, unknown>
  content?: string
  conversationId?: string
  sequence?: number
}

export interface ChatTransportCallbacks {
  onEvent: (event: TransportEvent) => void
  onStateChange: (state: TransportState) => void
  onError: (error: Error) => void
}

export interface SendMessageParams {
  content: string
  sessionId: string
  userTimezone?: string
  visualContext?: unknown
  aiEditContext?: unknown
  aiEditContexts?: unknown[]
  selectedAssets?: unknown[]
  todoListContext?: unknown
  isActionRequest?: boolean
  customContext?: unknown
  templateId?: string
  modelOverride?: string
  agentProfile?: string
  /** Rebuild page-selector "Build Page" slug — server builds it from source (AIROBUILD-2104) */
  rebuildBuildPageSlug?: string
  budgetServiceEnabled?: boolean
  subscriptionId?: string
  buildErrorContext?: { error: string; details: string; exitCode?: number } | null
  uploadedFileName?: string
  market?: string
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
