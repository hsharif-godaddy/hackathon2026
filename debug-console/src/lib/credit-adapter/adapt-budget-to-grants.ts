/**
 * Thin wrapper around @airo/shared/credit-adapter that injects debug-console's
 * logger. Pure logic lives in @airo/shared so app/ and debug-console can't drift.
 */

import {
  type AdapterLogger,
  adaptBudgetItemsToGrants as sharedAdaptItems,
  adaptBudgetToGrants as sharedAdapt,
} from '@airo/shared/credit-adapter'
import type { BudgetItem, BudgetResponse } from '@airo/shared/budget'
import type { CreditGrant } from '@airo/shared/grants'

import { logger } from '@/lib/logger'

const ADAPTER_LOGGER: AdapterLogger = {
  error: (event, ctx) => logger.error(event, ctx),
}

export function adaptBudgetToGrants(
  budget: BudgetResponse,
  subscriptionId: string
): CreditGrant[] {
  return sharedAdapt(budget, subscriptionId, ADAPTER_LOGGER)
}

export function adaptBudgetItemsToGrants(
  items: readonly BudgetItem[],
  budgetId: string,
  subscriptionId: string
): CreditGrant[] {
  return sharedAdaptItems(items, budgetId, subscriptionId, ADAPTER_LOGGER)
}
