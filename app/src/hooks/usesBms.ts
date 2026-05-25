import { getSwitchboardFlag } from '@/hooks/useSwitchboard'

/**
 * Checks whether either BMS gating flag is enabled in Switchboard.
 *
 * This is a CLIENT-SIDE gating check only — it does NOT replicate the server's
 * full migration-readiness decision (checkBmsMigration in agent-token route).
 * The JWT's budgetServiceEnabled field is the authoritative server decision.
 *
 * Flags checked:
 * - app-builder-budget-service: gates BMS for NEW users
 * - app-builder-bms-existing: gates BMS for EXISTING migrated users
 */
export function usesBms(): boolean {
  const budgetServiceEnabled = getSwitchboardFlag('app-builder-budget-service') ?? false
  const bmsExistingEnabled = getSwitchboardFlag('app-builder-bms-existing') ?? false
  return budgetServiceEnabled || bmsExistingEnabled
}
