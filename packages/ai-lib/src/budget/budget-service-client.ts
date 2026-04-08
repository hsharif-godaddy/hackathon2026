/**
 * Budget Service HTTP client
 *
 * Auth: IAM S2S JWT via getS2SToken (gd-auth-client).
 * createReport retries up to 3 times on transient failures (critical path for reconciliation).
 */

import { randomUUID } from 'node:crypto'
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
} from './errors.js'

// ── Config ──

export interface BudgetServiceClientConfig {
  baseUrl: string
  getToken?: () => Promise<string>
  getBudgetTimeoutMs?: number
  reportTimeoutMs?: number
  reportMaxRetries?: number
  tokenTimeoutMs?: number
  fetch?: typeof globalThis.fetch
}

const DEFAULT_GET_BUDGET_TIMEOUT = 3000
const DEFAULT_REPORT_TIMEOUT = 5000
const DEFAULT_REPORT_MAX_RETRIES = 3
const DEFAULT_TOKEN_TIMEOUT = 2000

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
  category: z.string(),
  budgetItems: z.array(BudgetItemDeductionSchema),
}).passthrough() as z.ZodType<ReportItemResponse>

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
    this.fetch = config.fetch ?? globalThis.fetch
  }

  // ── Public API ──

  async getBudget(budgetId: string): Promise<BudgetResponse> {
    return this.requestAndValidate(
      'GET', `/api/v1/budgets/${encodeURIComponent(budgetId)}`,
      BudgetResponseSchema, 'BudgetResponse', undefined, this.getBudgetTimeoutMs
    )
  }

  async createSession(budgetId: string): Promise<CreateSessionResponse> {
    return this.requestAndValidate(
      'POST', `/api/v1/budgets/${encodeURIComponent(budgetId)}/sessions`,
      CreateSessionResponseSchema, 'CreateSessionResponse', {}, this.getBudgetTimeoutMs
    )
  }

  async getSession(budgetId: string, sessionId: string): Promise<SessionResponse> {
    return this.requestAndValidate(
      'GET', `/api/v1/budgets/${encodeURIComponent(budgetId)}/sessions/${encodeURIComponent(sessionId)}`,
      SessionResponseSchema, 'SessionResponse', undefined, this.getBudgetTimeoutMs
    )
  }

  /** Retries up to reportMaxRetries times on transient failure (timeout, network unreachable). */
  async createReport(
    budgetId: string,
    sessionId: string,
    request: CreateReportRequest
  ): Promise<ReportResponse> {
    const path = `/api/v1/budgets/${encodeURIComponent(budgetId)}/sessions/${encodeURIComponent(sessionId)}/reports`
    const operationId = randomUUID()
    const body = { ...request, operationId }
    const doReport = () =>
      this.requestAndValidate('POST', path, ReportResponseSchema, 'ReportResponse', body, this.reportTimeoutMs)
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.reportMaxRetries; attempt++) {
      try {
        return await doReport()
      } catch (err) {
        lastErr = err
        const isTransient = err instanceof BudgetServiceTimeoutError || err instanceof BudgetServiceUnavailableError
        if (!isTransient || attempt === this.reportMaxRetries) throw err
        await new Promise((r) => setTimeout(r, 50 + Math.random() * (100 << (attempt + 1))))
      }
    }
    throw lastErr // unreachable, satisfies TS
  }

  async getReport(budgetId: string, sessionId: string, reportId: string): Promise<ReportResponse> {
    return this.requestAndValidate(
      'GET',
      `/api/v1/budgets/${encodeURIComponent(budgetId)}/sessions/${encodeURIComponent(sessionId)}/reports/${encodeURIComponent(reportId)}`,
      ReportResponseSchema, 'ReportResponse', undefined, this.getBudgetTimeoutMs
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

  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    timeoutMs?: number
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`
    const token = await Promise.race([
      this.getToken(),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new BudgetServiceTimeoutError('Budget Service token retrieval timed out')),
          this.tokenTimeoutMs
        )
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
      }),
    ])
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
