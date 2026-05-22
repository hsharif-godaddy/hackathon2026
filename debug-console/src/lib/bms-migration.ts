/**
 * BMS gating for the debug-console panel.
 *
 * Simpler than app/'s checkBmsMigration: no feature flags. This is an internal
 * admin view, so we want to show BMS data wherever it exists — including for
 * customers who haven't been flag-flipped yet. The only case we *don't* want
 * to show BMS is mid-migration, when bmsBudgetId may be set but ledger writes
 * are still going to legacy grants.
 */

const BMS_MIGRATION_ATTRIBUTE_KEY = 'bms-migration'

export interface BmsMigrationAttribute {
  key: string
  value?: { migrationDate?: string | null } | null
}

export interface BmsCheckSubscription {
  bmsBudgetId?: string | null
  attributes?: BmsMigrationAttribute[]
}

export type ShouldUseBmsResult =
  | { useBms: true; bmsBudgetId: string }
  | { useBms: false; reason: string }

export function shouldUseBms(
  subscription: BmsCheckSubscription | null | undefined
): ShouldUseBmsResult {
  if (!subscription) {
    return { useBms: false, reason: 'no-subscription' }
  }
  if (!subscription.bmsBudgetId) {
    return { useBms: false, reason: 'no-bms-budget-id' }
  }

  const migrationAttr = subscription.attributes?.find(
    (attr) => attr.key === BMS_MIGRATION_ATTRIBUTE_KEY
  )
  if (migrationAttr) {
    const rawDate = migrationAttr.value?.migrationDate
    const hasMigrationDate = typeof rawDate === 'string' && rawDate.length > 0
    if (!hasMigrationDate) {
      return { useBms: false, reason: 'migration-in-progress' }
    }
  }

  return { useBms: true, bmsBudgetId: subscription.bmsBudgetId }
}
