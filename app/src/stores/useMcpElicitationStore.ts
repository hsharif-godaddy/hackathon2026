/**
 * Transient bridge between browser-driven MCP elicitation handling and the
 * above-composer panel that renders the current request.
 *
 * Call cancel() on unmount/navigation so pending request() promises always settle.
 */

import { create } from 'zustand'
import type {
  ElicitationMode,
  ElicitationRequestedSchema,
  ElicitContentValue,
  ElicitResult,
} from '@airo/shared'

export interface PendingMcpElicitation {
  /** inputRequests key from the server; echoed back as the inputResponses key. */
  id: string
  /** MCP server id the originating tool call targeted. */
  serverId: string
  /** User-visible server name shown in the prompt surface. */
  serverDisplayName: string
  /** Tool being elicited for; display/telemetry only. */
  toolName: string
  mode: ElicitationMode
  /** params.message: why this prompt is needed. */
  message: string
  /** form mode: schema to render. */
  requestedSchema?: ElicitationRequestedSchema
  /** form mode: values to pre-fill, when known. */
  values?: Record<string, ElicitContentValue>
  /** url mode: page the user opens out of band. */
  url?: string
  /** Opaque server state echoed back by the client-action continuation loop. */
  requestState?: string
  /** url mode: true when the server asks the user to retry/check completion. */
  awaitingCompletion?: boolean
}

interface McpElicitationState {
  pending: PendingMcpElicitation | null
  resolve: ((result: ElicitResult) => void) | null
  request: (pending: PendingMcpElicitation) => Promise<ElicitResult>
  respond: (result: ElicitResult) => void
  cancel: () => void
}

export const useMcpElicitationStore = create<McpElicitationState>((set, get) => ({
  pending: null,
  resolve: null,
  request: (pending: PendingMcpElicitation): Promise<ElicitResult> => {
    const previousResolve = get().resolve
    previousResolve?.({ action: 'cancel' })

    return new Promise<ElicitResult>((resolve) => {
      set({ pending, resolve })
    })
  },
  respond: (result: ElicitResult): void => {
    get().resolve?.(result)
    set({ pending: null, resolve: null })
  },
  cancel: (): void => {
    get().resolve?.({ action: 'cancel' })
    set({ pending: null, resolve: null })
  },
}))
