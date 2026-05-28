import { BudgetExceededError, isBudgetExceededAPIError, containsBudgetExceededPattern } from '@airo/ai-common'

export type BudgetErrorSource = 'api_error' | 'pattern_match'

/** Discriminated result of stream-error budget classification. */
export type StreamBudgetErrorResult =
  | { type: 'budget_exceeded'; source: BudgetErrorSource; budgetError: BudgetExceededError }
  | { type: 'other'; error: Error }

/** Classify a stream-time error for budget detection. Used by
 * PartProcessorCallbacks.onError in both transports and mid-stream catches.
 *
 * No-throw contract: returns a discriminated result, never throws. Both
 * transports call this from their onError/catch path, so a throw here
 * would propagate unhandled. */
export function classifyStreamBudgetError(error: unknown): StreamBudgetErrorResult {
  if (isBudgetExceededAPIError(error)) {
    return {
      type: 'budget_exceeded',
      source: 'api_error',
      budgetError: new BudgetExceededError(
        'Your AI usage budget has been reached.',
        error.statusCode ?? 400,
        error.responseBody,
      ),
    }
  }
  const msg = error instanceof Error ? error.message : String(error)
  if (!BudgetExceededError.isInstance(error) && containsBudgetExceededPattern(msg)) {
    return {
      type: 'budget_exceeded',
      source: 'pattern_match',
      budgetError: new BudgetExceededError('Your AI usage budget has been reached.', 400, msg),
    }
  }
  return { type: 'other', error: error instanceof Error ? error : new Error(String(error)) }
}

/** Detect tool-validation errors that warrant an automatic retry with a
 * corrective prompt. Both transports check the same error message patterns. */
export function isToolValidationError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('toolUse.input is invalid') || msg.includes('JSON parsing failed')
}
