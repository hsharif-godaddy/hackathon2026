import type { CreditGrant } from './types'
import { GrantFinalState } from './types'

/**
 * Reasons why a grant cannot be used for LLM requests
 */
export enum GrantUnusableReason {
  NotAvailable = 'not_available',
  Consumed = 'consumed',
  Exhausted = 'exhausted',
  Expired = 'expired',
}

/**
 * Pure functions for grant validation and selection
 *
 * This is the SINGLE SOURCE OF TRUTH for grant logic.
 * Frontend imports via @airo/ai-lib/grants subpath export.
 */
export class GrantManager {
  /**
   * Check if a grant is currently usable for LLM requests
   *
   * A grant is usable when:
   * - isAvailable is true (not blocked by control plane)
   * - Not in a final state (consumed/expired)
   * - Has remaining capacity (creditsSpent < creditsMax)
   * - Not past expiration date (useBefore > now)
   */
  static isGrantUsable(grant: CreditGrant): boolean {
    // Use == null to match both null and undefined (API omits finalState when null)
    const notInFinalState = grant.finalState == null
    return (
      grant.isAvailable &&
      notInFinalState &&
      grant.creditsSpent < grant.creditsMax &&
      new Date(grant.useBefore) > new Date()
    )
  }

  /**
   * Get reason why a grant is unusable (for logging/debugging)
   */
  static getUnusableReason(grant: CreditGrant): GrantUnusableReason | null {
    if (!grant.isAvailable) return GrantUnusableReason.NotAvailable
    // Check for consumed state (finalState may be undefined or null when not set)
    if (grant.finalState === GrantFinalState.Consumed) return GrantUnusableReason.Consumed
    if (grant.finalState === GrantFinalState.Expired) return GrantUnusableReason.Expired
    if (grant.creditsSpent >= grant.creditsMax) return GrantUnusableReason.Exhausted
    if (new Date(grant.useBefore) <= new Date()) return GrantUnusableReason.Expired
    return null
  }

  /**
   * Select the best grant from a list
   * Returns first usable grant sorted by useBefore (earliest expiration first)
   */
  static selectBestGrant(grants: CreditGrant[]): CreditGrant | null {
    return (
      grants
        .filter((grant) => GrantManager.isGrantUsable(grant))
        .sort((a, b) => new Date(a.useBefore).getTime() - new Date(b.useBefore).getTime())[0] ??
      null
    )
  }
}
