// Socket event contract for token usage diagnostics.
import type { TokenUsage } from './model-pricing.js'

export const TOKEN_USAGE_SUMMARY_EVENT =
  'token.usage.summary' as const

// Payload emitted over socket when SOCKET_DIAGNOSTICS is enabled.
export interface TokenUsageSummaryEvent
  extends TokenUsage {
  modelName: string
  totalCost: number
  inputCost: number
  outputCost: number
  cachedInputCost?: number
  savings: number
  currency: string
}
