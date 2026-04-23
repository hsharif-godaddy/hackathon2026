import type { AgentContext } from '@airo/ai-lib'
import type { ExecutionContextMetadata } from '@airo/ai-grants'

/** Budget context fields for tool LLM calls (only populated when budget service enabled). */
export type ToolBudgetContext = Pick<ExecutionContextMetadata, 'bmsBudgetId' | 'budgetSessionId'>

/** Extract budget context fields from tool execution context. */
export function extractBudgetContext(context?: AgentContext): ToolBudgetContext {
  const metadata = context?.metadata as ExecutionContextMetadata | undefined
  return {
    bmsBudgetId: metadata?.bmsBudgetId,
    budgetSessionId: metadata?.budgetSessionId,
  }
}

/** Extend execution context metadata with budget fields (only when both present). */
export function withBudgetFields<T extends Record<string, unknown>>(
  baseMetadata: T,
  budgetContext?: ToolBudgetContext
): T & Partial<ToolBudgetContext> {
  if (budgetContext?.bmsBudgetId && budgetContext?.budgetSessionId) {
    return {
      ...baseMetadata,
      bmsBudgetId: budgetContext.bmsBudgetId,
      budgetSessionId: budgetContext.budgetSessionId,
    }
  }
  return baseMetadata
}
