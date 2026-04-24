/**
 * BFF Budget Service HTTP client
 *
 * Auth: IAM S2S JWT via getIamToken (gd-auth-client IamTokenClient).
 * BMS expects: Authorization: Bearer <token>
 *
 * URL is derived from request headers (like switchboard):
 *   https://budget-service.api.int.{rootDomain}
 *
 * Only exposes getBudget() -- session/report methods are agent-side only.
 */

import { z } from 'zod'
import type { BudgetItem, BudgetResponse } from '@airo/shared/budget'
import {
  BudgetNotFoundError,
  BudgetServiceAuthError,
  BudgetServiceError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
} from '@airo/shared/budget'

import { getIamToken } from '@/lib/iam-token'
import { logger } from '@/lib/request-context'
import { getRootDomainFromHeaders } from '@/utils/getRootDomain'

// ── Config ──

export interface BudgetServiceBffClientConfig {
  baseUrl: string
  getToken?: () => Promise<string>
  timeoutMs?: number
  tokenTimeoutMs?: number
  fetch?: typeof globalThis.fetch
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_TOKEN_TIMEOUT_MS = 2000

// ── Zod schemas ──
// Cast to z.ZodType<T> for passthrough compat. NOTE: the cast suppresses
// compile-time field checking -- schema drift is caught at runtime only.
// .passthrough() tolerates BMS adding fields without client changes.

const BudgetItemSchema = z.object({
  budgetItemId: z.string(),
  creditsTotal: z.string(),
  creditsUsed: z.string(),
  costToCreditRatio: z.string(),
  startsAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  resetInterval: z.string().nullable(),
}).passthrough() as z.ZodType<BudgetItem>

const BudgetResponseSchema = z.object({
  budgetId: z.string(),
  productKey: z.string(),
  creditsTotal: z.string(),
  creditsUsed: z.string(),
  creditsPending: z.string(),
  items: z.array(BudgetItemSchema),
}).passthrough() as z.ZodType<BudgetResponse>

function validateResponse<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  throw new BudgetServiceError(
    `Budget Service returned invalid ${label}: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    200,
    JSON.stringify(data).slice(0, 1024)
  )
}

// ── Client ──

export class BudgetServiceBffClient {
  private readonly baseUrl: string
  private readonly getToken: () => Promise<string>
  private readonly timeoutMs: number
  private readonly tokenTimeoutMs: number
  private readonly fetch: typeof globalThis.fetch

  constructor(config: BudgetServiceBffClientConfig) {
    const url = config.baseUrl.replace(/\/+$/, '')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`BUDGET_SERVICE_URL must be a valid URL (got: ${url})`)
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) {
      throw new Error(
        `BUDGET_SERVICE_URL must use HTTPS (got: ${url}). Only http://localhost is allowed for local dev.`
      )
    }
    this.baseUrl = url
    this.getToken = config.getToken ?? (() => getIamToken())
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.tokenTimeoutMs = config.tokenTimeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS
    this.fetch = config.fetch ?? globalThis.fetch
  }

  /**
   * Fetch budget by ID.
   * Callers should pass subscription.bmsBudgetId, not subscriptionId.
   */
  async getBudget(budgetId: string): Promise<BudgetResponse> {
    const data = await this.request(
      'GET',
      `/api/v1/budgets/${encodeURIComponent(budgetId)}`
    )
    return validateResponse(BudgetResponseSchema, data, 'BudgetResponse')
  }

  private async request(method: 'GET', path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`

    let tokenTimer: ReturnType<typeof setTimeout> | undefined
    let token: string
    try {
      token = await Promise.race([
        this.getToken(),
        new Promise<never>((_, reject) => {
          tokenTimer = setTimeout(
            () => reject(new BudgetServiceTimeoutError('Budget Service token retrieval timed out')),
            this.tokenTimeoutMs
          )
          if (typeof tokenTimer === 'object' && 'unref' in tokenTimer) tokenTimer.unref()
        }),
      ])
    } catch (err) {
      if (err instanceof BudgetServiceError) throw err
      throw new BudgetServiceUnavailableError('Budget Service token retrieval failed', err as Error)
    } finally {
      if (tokenTimer !== undefined) clearTimeout(tokenTimer)
    }

    let response: Response
    try {
      response = await this.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      const isTimeout =
        (err instanceof DOMException && err.name === 'TimeoutError') ||
        (err instanceof TypeError && err.message.includes('abort'))
      if (isTimeout) {
        throw new BudgetServiceTimeoutError(`Budget Service request timed out: ${method} ${path}`, err as Error)
      }
      throw new BudgetServiceUnavailableError(`Budget Service unreachable: ${method} ${path}`, err as Error)
    }

    return this.parseResponse(response, method, path)
  }

  private async parseResponse(response: Response, method: string, path: string): Promise<unknown> {
    const rawText = await response
      .text()
      .catch((err: unknown) => `[body read failed: ${err instanceof Error ? err.message : String(err)}]`)
    const text = rawText.length > 1024 ? rawText.slice(0, 1024) + '...[truncated]' : rawText

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new BudgetServiceAuthError(
          `Budget Service auth failed: ${response.status} ${method} ${path}`,
          response.status,
          text
        )
      }
      if (response.status === 404) {
        throw new BudgetNotFoundError(
          `Budget Service not found: ${method} ${path}`,
          text
        )
      }
      throw new BudgetServiceError(
        `Budget Service error: ${response.status} ${method} ${path}`,
        response.status,
        text
      )
    }

    if (!rawText) {
      throw new BudgetServiceError(`Budget Service returned empty response: ${method} ${path}`, response.status, '')
    }

    try {
      return JSON.parse(rawText)
    } catch {
      throw new BudgetServiceError(
        `Budget Service returned invalid JSON: ${method} ${path}`,
        response.status,
        text
      )
    }
  }
}

// ── URL Builder ──

const BUDGET_SERVICE_HOST_PREFIX = 'budget-service.api.int'

/**
 * Build Budget Service URL from request headers.
 * Pattern: https://budget-service.api.int.{rootDomain}
 */
export function getBudgetServiceUrl(headers: Headers): string | null {
  const rootDomain = getRootDomainFromHeaders(headers)
  if (!rootDomain) {
    logger.warn('budget.bff.client.noRootDomain', {
      message: 'Cannot determine Budget Service URL: no root domain from headers',
    })
    return null
  }

  return `https://${BUDGET_SERVICE_HOST_PREFIX}.${rootDomain}`
}

// ── Factory ──

/**
 * Create a Budget Service client for the current request.
 * URL is derived from request headers (environment-aware).
 *
 * Returns null if URL cannot be determined.
 */
export function getBudgetServiceClient(headers: Headers): BudgetServiceBffClient | null {
  const baseUrl = getBudgetServiceUrl(headers)
  if (!baseUrl) {
    return null
  }

  try {
    const client = new BudgetServiceBffClient({ baseUrl })
    logger.debug('budget.bff.client.created', { baseUrl })
    return client
  } catch (err) {
    logger.error('budget.bff.client.createFailed', {
      baseUrl,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
