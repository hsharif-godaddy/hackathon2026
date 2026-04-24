/**
 * Structured error types for error handling throughout the application
 */

import type { BudgetErrorType } from '@airo/shared/budget'

/**
 * Structured error with type classification and metadata
 */
export interface StructuredError {
  /** Human-readable error message */
  message: string
  /** Structured error type for programmatic handling */
  type?: 'BUDGET_EXCEEDED' | 'APP_NOT_FOUND' | 'UPSTREAM_ERROR' | 'RETRY_ERROR' | 'NETWORK_ERROR' | 'TOOL_VALIDATION_ERROR' | 'DATA_LOSS' | BudgetErrorType
  /** HTTP status code */
  statusCode?: number
  /** ISO timestamp of when the error occurred */
  timestamp?: string
  /** Number of retry attempts (for retry errors) */
  retryAttempts?: number
  /** Reason for retry failure (for retry errors) */
  retryReason?: string
}
