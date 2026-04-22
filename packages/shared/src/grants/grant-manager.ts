import type { CreditGrant } from './types.js'
import { GrantFinalState } from './types.js'

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

    if (grant.creditsSpent == null || grant.creditsMax == null) return false

    const creditsSpent = Number(grant.creditsSpent)
    const creditsMax = Number(grant.creditsMax)

    if (isNaN(creditsSpent) || isNaN(creditsMax)) return false

    // Budget exceeded check: creditsSpent >= creditsMax means grant is exhausted
    const hasRemainingCredits = creditsSpent < creditsMax

    // No useBefore means no expiration (always valid from time perspective)
    const notExpired = !grant.useBefore || new Date(grant.useBefore) > new Date()

    return (
      grant.isAvailable &&
      notInFinalState &&
      hasRemainingCredits &&
      notExpired
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
    // Treat null/undefined/NaN credits as exhausted (invalid data = unusable)
    if (grant.creditsSpent == null || grant.creditsMax == null) return GrantUnusableReason.Exhausted
    const spent = Number(grant.creditsSpent)
    const max = Number(grant.creditsMax)
    if (isNaN(spent) || isNaN(max) || spent >= max) return GrantUnusableReason.Exhausted
    // No useBefore means no expiration
    if (grant.useBefore && new Date(grant.useBefore) <= new Date()) return GrantUnusableReason.Expired
    return null
  }

  /**
   * Select the best grant from a list
   * Returns first usable grant sorted by useBefore (earliest expiration first, no expiration last)
   */
  static selectBestGrant(grants: CreditGrant[]): CreditGrant | null {
    return (
      grants
        .filter((grant) => GrantManager.isGrantUsable(grant))
        .sort((a, b) => {
          // Grants without useBefore (no expiration) go last
          if (!a.useBefore && !b.useBefore) return 0
          if (!a.useBefore) return 1
          if (!b.useBefore) return -1
          return new Date(a.useBefore).getTime() - new Date(b.useBefore).getTime()
        })[0] ??
      null
    )
  }
}
