/**
 * Shared tool response types and helper utilities for consistent agent tool responses.
 * Based on Anthropic's best practices for writing tools for agents.
 */

/**
 * Error details with actionable context.
 */
export interface ToolError {
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Optional hint to guide the agent toward resolution */
  hint?: string;
  /** Whether the operation can be retried */
  retryable?: boolean;
}

/**
 * Authentication requirements for tools that need OAuth.
 */
export interface ToolAuthRequirement {
  /** Authentication provider (e.g., 'godaddy') */
  provider: string;
  /** OAuth scopes required */
  scopes: string[];
  /** URL to redirect user for authorization */
  redirectUrl: string;
  /** Optional state parameter for OAuth flow */
  state?: string;
}

/**
 * Additional requirements needed to proceed with a tool operation.
 */
export interface ToolRequires {
  /** Authentication requirement if auth is needed */
  auth?: ToolAuthRequirement;
}

/**
 * Pagination information for paginated results.
 */
export interface ToolPagination {
  /** Cursor for fetching the next page */
  nextCursor?: string;
  /** Whether more results are available */
  hasMore?: boolean;
  /** Total count of items (if known) */
  totalCount?: number;
}

/**
 * Response metadata.
 */
export interface ToolMeta {
  /** Time taken to execute the operation in milliseconds */
  tookMs?: number;
  /** Response format used (concise or detailed) */
  responseFormat?: 'concise' | 'detailed';
  /** Whether output was truncated */
  truncated?: boolean;
}

/**
 * Standard tool response envelope.
 * 
 * @template T - The type of the data payload
 */
export interface ToolResponse<T = unknown> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Data payload (present when success is true) */
  data?: T;
  /** Error details (present when success is false) */
  error?: ToolError;
  /** Additional requirements needed (present when success is false and next step needed) */
  requires?: ToolRequires;
  /** Response metadata */
  meta?: ToolMeta;
  /** Pagination information for multi-page results */
  pagination?: ToolPagination;
}

/**
 * Creates a successful tool response.
 * 
 * @param data - The data payload to return
 * @param meta - Optional metadata
 * @returns A successful ToolResponse
 * 
 * @example
 * return ok({ products: [...] }, { tookMs: 123, responseFormat: 'concise' });
 */
export function ok<T>(data: T, meta?: ToolMeta): ToolResponse<T> {
  return {
    success: true,
    data,
    ...(meta && { meta }),
  };
}

/**
 * Creates a tool response indicating authentication is required.
 * 
 * @param error - The error details
 * @param requires - The authentication requirements
 * @param meta - Optional metadata
 * @returns A ToolResponse with auth requirements
 * 
 * @example
 * return needAuth(
 *   { code: 'AUTH_REQUIRED', message: 'Authentication required to proceed.' },
 *   { auth: { provider: 'godaddy', scopes: [...], redirectUrl: '...' } }
 * );
 */
export function needAuth(
  error: ToolError,
  requires: ToolRequires,
  meta?: ToolMeta
): ToolResponse<never> {
  return {
    success: false,
    error,
    requires,
    ...(meta && { meta }),
  };
}

/**
 * Creates a failed tool response.
 * 
 * @param error - The error details
 * @param meta - Optional metadata
 * @returns A failed ToolResponse
 * 
 * @example
 * return fail({ 
 *   code: 'INVALID_INPUT', 
 *   message: 'Missing required parameter', 
 *   hint: 'Provide storeId parameter' 
 * });
 */
export function fail(error: ToolError, meta?: ToolMeta): ToolResponse<never> {
  return {
    success: false,
    error,
    ...(meta && { meta }),
  };
}

/**
 * Common error codes used across tools.
 */
export const ErrorCodes = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_INPUT: 'INVALID_INPUT',
  CONTEXT_MISSING: 'CONTEXT_MISSING',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  TRUNCATED_OUTPUT: 'TRUNCATED_OUTPUT',
  DEV_SUPERVISOR_UNAVAILABLE: 'DEV_SUPERVISOR_UNAVAILABLE',
  NOT_FOUND: 'NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  OPERATION_FAILED: 'OPERATION_FAILED',
} as const;
