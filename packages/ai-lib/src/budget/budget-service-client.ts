/**
 * Budget Service HTTP client
 *
 * Auth: IAM S2S JWT via getS2SToken (gd-auth-client).
 * createReport retries up to 3 times on transient failures (critical path for reconciliation).
 * Token retrieval retries up to tokenMaxRetries times on timeout before propagating the error,
 * with exponential backoff — guards against slow IAM/SSO responses.
 */

import { z } from 'zod'
import { getS2SToken } from '../utils/s2s-auth.js'
import type {
  BudgetResponse,
  BudgetItem,
  CreateSessionResponse,
  SessionResponse,
  SessionItem,
} from '@airo/shared/budget'
import type {
  CreateReportRequest,
  ReportResponse,
  ReportItemResponse,
  BudgetItemDeduction,
} from './report-types.js'
import {
  BudgetServiceError,
  BudgetServiceAuthError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
  BudgetNotFoundError,
  BudgetNoCapacityError,
  BudgetServiceConflictError,
} from './errors.js'

// ── Config ──

export interface BudgetServiceClientConfig {
  baseUrl: string
  getToken?: () => Promise<string>
  getBudgetTimeoutMs?: number
  reportTimeoutMs?: number
  reportMaxRetries?: number
  tokenTimeoutMs?: number
  tokenMaxRetries?: number
  fetch?: typeof globalThis.fetch
}

const DEFAULT_GET_BUDGET_TIMEOUT = 3000
const DEFAULT_REPORT_TIMEOUT = 5000
const DEFAULT_REPORT_MAX_RETRIES = 3
const DEFAULT_TOKEN_TIMEOUT = 5000
const DEFAULT_TOKEN_MAX_RETRIES = 2

// ── Response schemas ──
// .passthrough() tolerates BMS adding fields without client changes.
// Type safety enforced by the `as z.ZodType<T>` cast against @airo/shared interfaces.

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

const CreateSessionResponseSchema = z.object({
  sessionId: z.string(),
}).passthrough() as z.ZodType<CreateSessionResponse>

const SessionItemSchema = z.object({
  cost: z.number(),
  callRequestId: z.string(),
}).passthrough() as z.ZodType<SessionItem>

const SessionResponseSchema = z.object({
  costTotal: z.number(),
  sessionItems: z.array(SessionItemSchema),
}).passthrough() as z.ZodType<SessionResponse>

const BudgetItemDeductionSchema = z.object({
  budgetItemId: z.string(),
  creditsUsed: z.number(),
}).passthrough() as z.ZodType<BudgetItemDeduction>


const ReportItemResponseSchema = z.object({
  budgetCost: z.number(),
  productCost: z.number(),
  label: z.string(),
  budgetItems: z.array(BudgetItemDeductionSchema),
}).passthrough().transform((item): ReportItemResponse => ({
  budgetCost: item.budgetCost,
  productCost: item.productCost,
  category: item.label,
  budgetItems: item.budgetItems,
}))

const ReportResponseSchema = z.object({
  reportId: z.string(),
  budgetId: z.string(),
  sessionId: z.string(),
  productKey: z.string(),
  budgetCostTotal: z.number(),
  productCostTotal: z.number(),
  creditsAvailable: z.number(),
  reportItems: z.array(ReportItemResponseSchema),
}).passthrough() as z.ZodType<ReportResponse>

// BMS encodes money as a JSON number for /reports/aggregate but the OpenAPI
// spec hedges with oneOf(string|number) to match the rest of the API.
// Coerce to number so callers always get a finite number.
const moneyAsNumber = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expected finite number' })
    return z.NEVER
  }
  return n
})

const ReportAggregateResponseSchema = z.object({
  productKey: z.string().optional(),
  label: z.string().optional(),
  from: z.string(),
  to: z.string(),
  budgetCostTotal: moneyAsNumber,
  productCostTotal: moneyAsNumber,
  reportLineCount: z.number().int().nonnegative(),
}).passthrough()

export interface ReportAggregateParams {
  budgetId?: string
  sessionId?: string
  productKey?: string
  label?: string
  /** Inclusive start. Pass a Date or RFC3339 string. */
  from?: Date | string
  /** Exclusive end. */
  to?: Date | string
}

export interface ReportAggregateResponse {
  productKey?: string
  label?: string
  from: string
  to: string
  budgetCostTotal: number
  productCostTotal: number
  reportLineCount: number
}

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

export class BudgetServiceClient {
  private readonly baseUrl: string
  private readonly getToken: () => Promise<string>
  private readonly getBudgetTimeoutMs: number
  private readonly reportTimeoutMs: number
  private readonly reportMaxRetries: number
  private readonly tokenTimeoutMs: number
  private readonly tokenMaxRetries: number
  private readonly fetch: typeof globalThis.fetch

  constructor(config: BudgetServiceClientConfig) {
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
    this.getToken = config.getToken ?? (() => getS2SToken())
    this.getBudgetTimeoutMs = config.getBudgetTimeoutMs ?? DEFAULT_GET_BUDGET_TIMEOUT
    this.reportTimeoutMs = config.reportTimeoutMs ?? DEFAULT_REPORT_TIMEOUT
    this.reportMaxRetries = config.reportMaxRetries ?? DEFAULT_REPORT_MAX_RETRIES
    this.tokenTimeoutMs = config.tokenTimeoutMs ?? DEFAULT_TOKEN_TIMEOUT
    this.tokenMaxRetries = config.tokenMaxRetries ?? DEFAULT_TOKEN_MAX_RETRIES
    this.fetch = config.fetch ?? globalThis.fetch
  }

  // ── Public API ──

  async getBudget(budgetId: string): Promise<BudgetResponse> {
    return this.requestAndValidate(
      'GET', `/api/v1/budgets/${encodeURIComponent(budgetId)}`,
      BudgetResponseSchema, 'BudgetResponse', undefined, this.getBudgetTimeoutMs
    )
  }

  async createSession(budgetId: string, options?: { allowOverage?: boolean }): Promise<CreateSessionResponse> {
    const body: Record<string, unknown> = { budgetId }
    if (options?.allowOverage) body.allowOverage = true
    return this.requestAndValidate(
      'POST', `/api/v1/sessions`,
      CreateSessionResponseSchema, 'CreateSessionResponse', body, this.getBudgetTimeoutMs
    )
  }

  async getSession(sessionId: string): Promise<SessionResponse> {
    return this.requestAndValidate(
      'GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      SessionResponseSchema, 'SessionResponse', undefined, this.getBudgetTimeoutMs
    )
  }

  /**
   * Create a cost attribution report for a session.
   * Retries on transient errors.
   *
   * @throws BudgetServiceConflictError - report already exists (409)
   */
  async createReport(
    sessionId: string,
    request: CreateReportRequest
  ): Promise<ReportResponse> {
    const path = `/api/v1/sessions/${encodeURIComponent(sessionId)}/reports`
    const doReport = () =>
      this.requestAndValidate('POST', path, ReportResponseSchema, 'ReportResponse', request, this.reportTimeoutMs)
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.reportMaxRetries; attempt++) {
      try {
        return await doReport()
      } catch (err) {
        // 409 = report already exists — don't retry, let caller handle as success
        if (err instanceof BudgetServiceConflictError) throw err
        lastErr = err
        const isTransient = err instanceof BudgetServiceTimeoutError || err instanceof BudgetServiceUnavailableError
        if (!isTransient || attempt === this.reportMaxRetries) throw err
        await new Promise((r) => setTimeout(r, 50 + Math.random() * (100 << (attempt + 1))))
      }
    }
    throw lastErr // unreachable, satisfies TS
  }

  async getReport(sessionId: string, reportId: string): Promise<ReportResponse> {
    return this.requestAndValidate(
      'GET',
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/reports/${encodeURIComponent(reportId)}`,
      ReportResponseSchema, 'ReportResponse', undefined, this.getBudgetTimeoutMs
    )
  }

  /**
   * Aggregate budgetCost and productCost over a time window.
   * BMS requires at least one of `productKey` or `label` (or both); when
   * `from`/`to` are both omitted, BMS defaults to the last 1 calendar month.
   */
  async getReportsAggregate(params: ReportAggregateParams = {}): Promise<ReportAggregateResponse> {
    const search = new URLSearchParams()
    const setIf = (k: string, v: string | undefined): void => {
      if (v !== undefined && v !== '') search.set(k, v)
    }
    const toIso = (v: Date | string | undefined): string | undefined => {
      if (v === undefined) return undefined
      return v instanceof Date ? v.toISOString() : v
    }
    setIf('budgetId', params.budgetId)
    setIf('sessionId', params.sessionId)
    setIf('productKey', params.productKey)
    setIf('label', params.label)
    setIf('from', toIso(params.from))
    setIf('to', toIso(params.to))

    const qs = search.toString()
    const path = `/api/v1/reports/aggregate${qs ? `?${qs}` : ''}`
    return this.requestAndValidate(
      'GET', path,
      ReportAggregateResponseSchema as z.ZodType<ReportAggregateResponse>,
      'ReportAggregateResponse',
      undefined, this.getBudgetTimeoutMs
    )
  }

  // ── Internal ──

  private async requestAndValidate<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    schema: z.ZodType<T>,
    label: string,
    body?: unknown,
    timeoutMs?: number
  ): Promise<T> {
    const data = await this.request(method, path, body, timeoutMs)
    return validateResponse(schema, data, label)
  }

  // Worst case under sustained IAM slowness: (tokenMaxRetries+1) × (reportMaxRetries+1) × tokenTimeoutMs (~60s).
  private async getTokenWithRetry(): Promise<string> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.tokenMaxRetries; attempt++) {
      try {
        return await Promise.race([
          this.getToken(),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(
              () => reject(new BudgetServiceTimeoutError('Budget Service token retrieval timed out')),
              this.tokenTimeoutMs
            )
            if (typeof timer === 'object' && 'unref' in timer) timer.unref()
          }),
        ])
      } catch (err) {
        if (!(err instanceof BudgetServiceTimeoutError) || attempt === this.tokenMaxRetries) throw err
        lastErr = err
        await new Promise((r) => setTimeout(r, 100 * (1 << attempt))) // 100ms, 200ms
      }
    }
    throw lastErr // unreachable, satisfies TS
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    timeoutMs?: number
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`
    const token = await this.getTokenWithRetry()
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs ?? this.getBudgetTimeoutMs),
    }
    if (body && (method === 'POST' || method === 'PATCH')) init.body = JSON.stringify(body)

    let response: Response
    try {
      response = await this.fetch(url, init)
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
      if (response.status === 402) {
        throw new BudgetNoCapacityError(
          `Budget Service no capacity: ${method} ${path}`,
          text
        )
      }
      if (response.status === 404) {
        throw new BudgetNotFoundError(
          `Budget Service not found: ${method} ${path}`,
          text
        )
      }
      if (response.status === 409) {
        throw new BudgetServiceConflictError(
          `Budget Service conflict: ${response.status} ${method} ${path}`,
          response.status,
          text
        )
      }
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new BudgetServiceUnavailableError(
          `Budget Service unavailable: ${response.status} ${method} ${path}`,
          response.status,
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
