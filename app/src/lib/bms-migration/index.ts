/**
 * BMS Migration Check
 *
 * Determines if a subscription should use BMS (Budget Management Service).
 *
 * Three scenarios:
 * - NEW users: budgetServiceEnabled flag + bmsBudgetId + NO bms-migration attribute → use BMS
 * - EXISTING users (migration complete): bmsExistingEnabled flag + bmsBudgetId + bms-migration attribute with migrationDate NOT null → use BMS
 * - EXISTING users (migration in progress): bms-migration attribute with migrationDate=null → fallback to grants
 *
 * Important distinction:
 * - "No migration attribute" = the bms-migration key does NOT exist → NEW user
 * - "Migration in progress" = bms-migration attribute EXISTS but migrationDate is null → NOT ready for BMS
 * - "Migration complete" = bms-migration attribute EXISTS and migrationDate is set → ready for BMS
 *
 * Usage:
 *   if (shouldCheckBmsMigration(flags) && subscriptionId) {
 *     const subscription = await mgmtClient.getSubscription(id, { includeAttributes: true });
 *     const result = checkBmsMigration(subscription, flags);
 *     if (result.useBms) { ... }
 *   }
 *
 * See: https://godaddy-corp.atlassian.net/wiki/spaces/PAR/pages/4387899395/BMS+Integration+Migration+Plan
 */

import type { AiroSubscription } from '@/lib/mgmt-airo';
import { ATTRIBUTE_KEYS } from '@/lib/mgmt-airo';

export interface BmsMigrationFlags {
  budgetServiceEnabled: boolean;
  bmsExistingEnabled: boolean;
}

export interface BmsMigrationResult {
  /** Whether BMS should be used for this subscription */
  useBms: boolean;
  /** BMS budget ID if enabled, undefined otherwise */
  bmsBudgetId: string | undefined;
  /** Reason BMS is not enabled (for logging) */
  reason?: string;
}

/**
 * Check if feature flags allow BMS check.
 * Use this before fetching subscription to avoid unnecessary API calls.
 *
 * Either flag enables the BMS path:
 * - budgetServiceEnabled: for NEW users created with BMS budgets
 * - bmsExistingEnabled: for EXISTING users being migrated to BMS
 *
 * @param flags - Feature flag states
 * @returns true if either flag is enabled
 */
export function shouldCheckBmsMigration(flags: BmsMigrationFlags): boolean {
  return flags.budgetServiceEnabled || flags.bmsExistingEnabled;
}

/**
 * Check if a subscription should use BMS.
 *
 * Logic:
 * 1. If subscription HAS bms-migration attribute with migrationDate NOT null → EXISTING user, migration complete → requires bmsExistingEnabled flag
 * 2. If subscription HAS bms-migration attribute with migrationDate null → EXISTING user, migration in progress → NOT ready for BMS
 * 3. If subscription has bmsBudgetId but NO bms-migration attribute → NEW user → requires budgetServiceEnabled flag
 *
 * @param subscription - Subscription data (must include attributes via includeAttributes: true)
 * @param flags - Feature flag states
 * @returns Result with useBms flag and bmsBudgetId
 */
export function checkBmsMigration(
  subscription: Pick<AiroSubscription, 'bmsBudgetId' | 'attributes'> | null | undefined,
  flags: BmsMigrationFlags
): BmsMigrationResult {
  if (!subscription) {
    return { useBms: false, bmsBudgetId: undefined, reason: 'no-subscription' };
  }

  if (!subscription.bmsBudgetId) {
    return { useBms: false, bmsBudgetId: undefined, reason: 'no-bms-budget-id' };
  }

  const migrationAttr = subscription.attributes?.find(attr => attr.key === ATTRIBUTE_KEYS.BMS_MIGRATION);
  const hasMigrationAttribute = migrationAttr !== undefined;
  const rawMigrationDate = migrationAttr?.value?.migrationDate;
  const hasMigrationDate = typeof rawMigrationDate === 'string' && rawMigrationDate.length > 0;

  if (hasMigrationAttribute) {
    // EXISTING user — has migration attribute
    if (!hasMigrationDate) {
      // Migration in progress (migrationDate is null) — not ready for BMS yet
      return { useBms: false, bmsBudgetId: undefined, reason: 'migration-in-progress' };
    }
    // Migration complete (migrationDate is set) — requires bmsExistingEnabled flag
    if (!flags.bmsExistingEnabled) {
      return { useBms: false, bmsBudgetId: undefined, reason: 'existing-user-flag-disabled' };
    }
    return { useBms: true, bmsBudgetId: subscription.bmsBudgetId };
  }

  // NEW user (no migration attribute at all) — requires budgetServiceEnabled flag
  if (!flags.budgetServiceEnabled) {
    return { useBms: false, bmsBudgetId: undefined, reason: 'new-user-flag-disabled' };
  }
  return { useBms: true, bmsBudgetId: subscription.bmsBudgetId };
}

/**
 * Extract migration date from subscription attributes if present.
 */
export function getMigrationDate(subscription: Pick<AiroSubscription, 'attributes'> | null | undefined): string | undefined {
  const migrationAttr = subscription?.attributes?.find(attr => attr.key === ATTRIBUTE_KEYS.BMS_MIGRATION);
  const rawDate = migrationAttr?.value?.migrationDate;
  return typeof rawDate === 'string' && rawDate.length > 0 ? rawDate : undefined;
}
