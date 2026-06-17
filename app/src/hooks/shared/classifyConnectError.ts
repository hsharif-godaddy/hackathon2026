import { AppErrorCode } from '@/types/error-codes'

export type ConnectErrorClass = 'deterministic' | 'provisioning' | 'network'

/**
 * Classify a useSSEChat connect-time failure so the caller can branch:
 * deterministic app-unavailable → give up immediately; provisioning race →
 * bounded retry-until-ready; network → existing behavior. (AIROBUILD-2628)
 *
 * Matches on the error message strings thrown by getConfigForSite /
 * getAgentToken. A typed error at those throw sites would let this switch on a
 * discriminant instead of parsing strings — worthwhile follow-up.
 */
export function classifyConnectError(err: unknown): ConnectErrorClass {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes(AppErrorCode.SITE_NOT_FOUND)) return 'deterministic'
  if (/Failed to get agent token: 40[34]/.test(message)) return 'deterministic'
  if (message.includes('is not ready yet')) return 'provisioning'
  return 'network'
}
