/**
 * Thin wrapper around @airo/shared/credit-adapter that injects this app's
 * request-context logger. The pure adapter lives in shared so debug-console
 * and any other consumer can call it without forking the logic.
 */

import type { BudgetItem, BudgetResponse } from '@airo/shared/budget'
import {
  adaptBudgetItemsToGrants as sharedAdaptItems,
  adaptBudgetToGrants as sharedAdapt,
  type AdapterLogger,
} from '@airo/shared/credit-adapter'
import type { CreditGrant } from '@airo/shared/grants'

import { logger } from '@/lib/request-context'

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
