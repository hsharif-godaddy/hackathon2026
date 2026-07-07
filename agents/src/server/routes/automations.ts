/**
 * Automations Routes
 *
 * POST /api/automations/run — hosting control plane dispatches a scheduled or
 * manual automation run. Auth is a hosting-minted app JWT for the site.
 *
 * Flow:
 * 1. 409 (retryable) if another automation run is already in flight for this
 *    app, or if the user has an active SSE connection (may be mid-turn).
 * 2. 202 immediately; run async.
 * 3. Read job definition from .airo/jobs/{defnRef}/{defnRef}.md.
 * 4. Reuse existing conversation (same conversationId as main chat).
 * 5. Execute via MessageExecutionService.execute() — existing agent loop.
 *    automationId is set so the loop writes the run summary file to .airo/.
 * 6. Read full output from the written summary file.
 * 7. Push automation_run_complete SSE event if user is online.
 * 8. POST callback to hosting with S2S Bearer token + X-Airo-Event-Sig HMAC header.
 */

import { createHmac } from 'node:crypto'

import { Router, type Router as ExpressRouter, type Request, type Response } from 'express'
import matter from 'gray-matter'
import { z } from 'zod'
import { getS2SToken, isS2SAuthEnabled } from '@airo/ai-lib'
import { getConversationLifecycleStore } from '../../memory/adapters/index.js'
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { createForWorkspace } from '../../workspace/index.js'
import { logger } from '../../logging/index.js'
import { getSSERegistry } from '../sse/registry-singleton.js'
import { auth } from '../../services/features.js'
import { getSwitchboardFlag } from '../../services/switchboard.js'
import { asyncHandler } from '../middleware/async-handler.js'
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js'
import { getNomadAllocConfigValue } from '../../utils/nomad-config.js'

export const AUTOMATION_SCHEDULING_FLAG = 'appbuilder-automation-scheduling'

const JOBS_DIR = '.airo/jobs'
const CALLBACK_SUMMARY_MAX_CHARS = 500


// Module-level set of appIds with an automation run in progress.
const activeAutomationRuns = new Set<string>()

// runId → AbortController + owning appId for cancel support.
const runControllers = new Map<string, { controller: AbortController; appId: string }>()

/** Clears in-flight automation state between tests. */
export function resetAutomationRunStateForTests(): void {
  activeAutomationRuns.clear()
  runControllers.clear()
}

export const automationsRouter: ExpressRouter = Router()

const RunRequestSchema = z.object({
  runId: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'runId must be alphanumeric, dash, or underscore'),
  defnRef: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'defnRef must be alphanumeric, dash, or underscore'),
  defnLocation: z.string().nullish(),
  tokenBudget: z.number().int().nonnegative().nullish(),
  timeoutSeconds: z.number().int().positive().max(86400).nullish(),
  scheduledSlot: z.string().nullish(),
  scheduled_slot: z.string().nullish(),
})

// POST /api/automations/run
automationsRouter.post('/run', asyncHandler(async (req: Request, res: Response) => {
  const agentCtx = (req as AuthenticatedRequest).agentContext
  const appId = agentCtx?.siteId

  if (!appId) {
    res.status(401).json({ error: 'Missing app identity in token' })
    return
  }

  // Feature flag: disabled for all by default; enable via Switchboard.
  if (!getSwitchboardFlag(AUTOMATION_SCHEDULING_FLAG, false)) {
    logger.info('automations.run.flag_disabled', { appId })
    res.status(403).json({ error: 'Automation scheduling is not enabled', failureClass: 'non_retryable' })
    return
  }

  const parsed = RunRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors })
    return
  }

  const {
    runId, defnLocation, defnRef, tokenBudget, timeoutSeconds,
    scheduledSlot: scheduledSlotCamel, scheduled_slot: scheduledSlotSnake,
  } = parsed.data
  // Accept both camelCase (spec) and snake_case (Go default JSON serialisation).
  const scheduledSlot = scheduledSlotCamel ?? scheduledSlotSnake

  logger.info('automations.run.received', { appId, runId, defnRef, scheduledSlot: scheduledSlot ?? 'none' })

  // 409 retryable: another automation run is already in flight.
  // Guard add() immediately to close the TOCTOU window before any async yield.
  if (activeAutomationRuns.has(appId)) {
    logger.info('automations.run.busy_automation', { appId, runId })
    res.status(409).json({ error: 'Another automation run is in progress', failureClass: 'retryable' })
    return
  }
  activeAutomationRuns.add(appId)

  // 409 retryable: user has a chat turn actively streaming (mid-turn).
  // A bare SSE connection (tab open but idle) is not sufficient to block —
  // the user clicked Run Now from that same tab, so SSE will always be open.
  const openConversations = getSSERegistry()?.getConversationsByApp(appId) ?? []
  if (openConversations.length > 0) {
    const { getOrCreateSSEExecutionServiceForAutomation } = await import('../app.js')
    const executionService = getOrCreateSSEExecutionServiceForAutomation()
    const isMidTurn = executionService !== null && openConversations.some(
      convId => executionService.hasActiveStream(convId),
    )
    if (isMidTurn) {
      activeAutomationRuns.delete(appId)
      logger.info('automations.run.user_active', { appId, runId })
      res.status(409).json({ error: 'User has a chat turn in progress', failureClass: 'retryable' })
      return
    }
  }

  res.status(202).json({ runId })
  const controller = new AbortController()
  runControllers.set(runId, { controller, appId })

  runAutomation({
    appId,
    runId,
    defnLocation: defnLocation ?? JOBS_DIR,
    defnRef,
    scheduledSlot: scheduledSlot ?? undefined,
    tokenBudget: tokenBudget ?? 0,
    timeoutSeconds: timeoutSeconds ?? 3540,
    signal: controller.signal,
  }).finally(() => {
    activeAutomationRuns.delete(appId)
    runControllers.delete(runId)
  })
}))

// POST /api/automations/run/:runId/cancel
automationsRouter.post('/run/:runId/cancel', asyncHandler(async (req: Request, res: Response) => {
  const agentCtx = (req as AuthenticatedRequest).agentContext
  const appId = agentCtx?.siteId
  const { runId } = req.params

  const entry = runControllers.get(runId!)
  if (!entry) {
    res.status(404).json({ error: 'No active run with that runId' })
    return
  }

  if (appId && entry.appId !== appId) {
    logger.warn('automations.cancel.wrong_owner', { appId, runId, ownerAppId: entry.appId })
    res.status(403).json({ error: 'Run does not belong to this app' })
    return
  }

  entry.controller.abort('user_cancel')
  res.status(202).json({ runId, status: 'cancelling' })
}))

// ---------------------------------------------------------------------------
// Core async runner
// ---------------------------------------------------------------------------

interface RunParams {
  appId: string
  runId: string
  defnLocation: string
  defnRef: string
  /** ISO-8601 cron slot from hosting (e.g. "2026-07-07T09:00:00Z"). Present for
   *  scheduled runs; absent for manual dispatches. Used as the idempotency key:
   *  if a summary already exists for this slot we skip re-execution and re-post
   *  the existing result (handles agent crash + hosting retry). */
  scheduledSlot?: string
  tokenBudget: number
  timeoutSeconds: number
  signal: AbortSignal
}

/** Sanitise a scheduledSlot ISO string into a filesystem-safe filename segment.
 *  "2026-07-07T09:00:00Z" → "2026-07-07T09-00-00Z" (colons → dashes). */
function slotToFilename(slot: string): string {
  return slot.replace(/:/g, '-')
}

async function runAutomation(params: RunParams): Promise<void> {
  const { appId, runId, defnRef, scheduledSlot, tokenBudget, timeoutSeconds, signal } = params

  // Abort just before the hosting reconcile window fires.
  const timeoutHandle = setTimeout(
    () => runControllers.get(runId)?.controller.abort('timeout'),
    timeoutSeconds * 1000,
  )

  let conversationId: string | undefined
  let summaryRef: string | undefined

  try {
    // ── L3: Slot-based idempotency ───────────────────────────────────────────
    // If airo-go sent a scheduledSlot, check whether a summary for that slot
    // already exists on disk (written by a previous attempt that succeeded but
    // whose callback failed). If found, skip re-execution and re-post the
    // existing result under the new runId — hosting gets the correct outcome
    // without the agent running the job again.
    if (scheduledSlot) {
      const slotSummaryRef = `${JOBS_DIR}/${defnRef}/runs/scheduled_${slotToFilename(scheduledSlot)}_summary.md`
      const existing = await readRunFile(appId, slotSummaryRef)
      // Only treat as already-done if the prior run actually completed successfully.
      // A failed run's file must not suppress re-execution on the next retry.
      if (existing && existing.status === 'completed') {
        logger.info('automations.run.slot_already_done', { appId, runId, defnRef, scheduledSlot, slotSummaryRef })
        const summary = existing.content.slice(0, CALLBACK_SUMMARY_MAX_CHARS)
        getSSERegistry()?.sendToApp(appId, 'automation_run_complete', {
          runId, defnRef, status: 'succeeded', summary, summaryRef: slotSummaryRef,
        })
        await postCallback(appId, runId, { status: 'succeeded', summary, summaryRef: slotSummaryRef })
        return
      }
    }

    const jobPrompt = await readJobDefinition(appId, defnRef)
    if (!jobPrompt) {
      logger.warn('automations.run.job_not_found', { appId, runId, defnRef })
      await postCallback(appId, runId, {
        status: 'failed',
        failureClass: 'non_retryable',
        reasonCode: 'job_not_found',
        error: `Job definition not found: ${JOBS_DIR}/${defnRef}/${defnRef}.md`,
      })
      return
    }

    // Reuse existing conversation (same as main chat).
    const lifecycle = getConversationLifecycleStore()
    const { conversation } = await lifecycle.getOrCreateForApp(
      workspaceScopeFromAppId(appId),
      'develop',
    )
    conversationId = conversation.id

    // Lazy-import to avoid circular dependency: app.ts imports routes,
    // routes cannot import app.ts at module load time.
    const { getOrCreateSSEExecutionServiceForAutomation } = await import('../app.js')
    const executionService = getOrCreateSSEExecutionServiceForAutomation()

    if (!executionService) {
      await postCallback(appId, runId, {
        status: 'failed',
        failureClass: 'retryable',
        reasonCode: 'agent_not_ready',
        error: 'Agent execution service not initialised',
      })
      return
    }

    // execute() persists the full conversation and writes the summary file.
    // automationRunId is included so the filename is predictable.
    await executionService.execute({
      appId,
      conversationId,
      content: jobPrompt,
      siteId: appId,
      agentId: 'develop',
      automationId: defnRef,
      automationRunId: runId,
      ...(scheduledSlot && { automationScheduledSlot: scheduledSlot }),
      abortSignal: signal,
      ...(tokenBudget > 0 && { budgetSessionId: `automation:${runId}` }),
    })

    if (signal.aborted) {
      await reportAbortedRun({ appId, runId, defnRef, signal, conversationId, summaryRef })
      return
    }

    // MES writes the summary at a predictable path:
    //   scheduled_{slot}_summary.md          — cron dispatch (slot is stable across retries)
    //   scheduled_{runId}_{convId}_summary.md — cron dispatch without slot (shouldn't happen)
    //   manual_{runId}_{convId}_summary.md   — manual dispatch via hosting
    summaryRef = scheduledSlot
      ? `${JOBS_DIR}/${defnRef}/runs/scheduled_${slotToFilename(scheduledSlot)}_summary.md`
      : `${JOBS_DIR}/${defnRef}/runs/manual_${runId}_${conversationId}_summary.md`

    const runFile = await readRunFile(appId, summaryRef)

    if (!runFile) {
      logger.warn('automations.run.summary_missing', { appId, runId, defnRef, summaryRef })
      getSSERegistry()?.sendToApp(appId, 'automation_run_complete', {
        runId, defnRef, status: 'failed',
        error: 'Run summary file missing', conversationId, summaryRef,
      })
      await postCallback(appId, runId, {
        status: 'failed',
        failureClass: 'non_retryable',
        reasonCode: 'summary_missing',
        error: `Summary file not found: ${summaryRef}`,
      })
      return
    }

    // Gate success on the status written by MES — a loop abort writes 'failed'
    // in frontmatter even though the file exists.
    const runSucceeded = runFile.status === 'completed'
    const summary = runFile.content.slice(0, CALLBACK_SUMMARY_MAX_CHARS)

    getSSERegistry()?.sendToApp(appId, 'automation_run_complete', {
      runId, defnRef, status: runSucceeded ? 'succeeded' : 'failed',
      summary, summaryRef, conversationId,
    })

    if (runSucceeded) {
      await postCallback(appId, runId, { status: 'succeeded', summary, summaryRef })
    } else {
      await postCallback(appId, runId, {
        status: 'failed',
        failureClass: 'non_retryable',
        reasonCode: 'execution_error',
        summary,
      })
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('automations.run.error', {
      appId, runId, defnRef, error: errorMsg,
      isTimeout: isAbortReason(signal, 'timeout'),
      isCancel: isAbortReason(signal, 'user_cancel'),
    })
    await reportAbortedRun({ appId, runId, defnRef, signal, conversationId, summaryRef, error: errorMsg })
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function isAbortReason(signal: AbortSignal, reason: string): boolean {
  return signal.aborted && String(signal.reason) === reason
}

async function reportAbortedRun(opts: {
  appId: string
  runId: string
  defnRef: string
  signal: AbortSignal
  conversationId?: string
  summaryRef?: string
  error?: string
}): Promise<void> {
  const { appId, runId, defnRef, signal, conversationId, summaryRef, error } = opts
  const isTimeout = isAbortReason(signal, 'timeout')
  const isCancel = isAbortReason(signal, 'user_cancel')
  const errorMsg = error ?? (isCancel ? 'Run cancelled' : isTimeout ? 'Run timed out' : 'Run aborted')

  getSSERegistry()?.sendToApp(appId, 'automation_run_complete', {
    runId,
    defnRef,
    status: isCancel ? 'cancelled' : 'failed',
    error: errorMsg,
    conversationId,
    ...(summaryRef && { summaryRef }),
  })

  if (isCancel) {
    await postCallback(appId, runId, { status: 'cancelled' })
  } else {
    await postCallback(appId, runId, {
      status: 'failed',
      failureClass: isTimeout ? 'retryable' : 'non_retryable',
      reasonCode: isTimeout ? 'agent_timeout' : 'execution_error',
      error: errorMsg,
    })
  }
}

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

async function readJobDefinition(appId: string, defnRef: string): Promise<string | null> {
  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) return null

  try {
    const rawContent = await workspace.files.readText({ path: `${JOBS_DIR}/${defnRef}/${defnRef}.md` })
    if (!rawContent) return null
    const { data, content } = matter(rawContent)
    const name = typeof data.name === 'string' ? data.name : defnRef
    const description = typeof data.description === 'string' ? ` — ${data.description}` : ''
    return `[Automation: ${name}${description}]\n\n${content.trim()}`
  } catch (err) {
    logger.warn('automations.run.read_job_failed', {
      appId,
      defnRef,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

interface RunFileResult {
  /** Body content (frontmatter stripped). */
  content: string
  /** `status` field from frontmatter — 'completed' | 'failed' | undefined. */
  status: string | undefined
}

async function readRunFile(appId: string, path: string): Promise<RunFileResult | undefined> {
  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) return undefined
  try {
    const rawContent = await workspace.files.readText({ path })
    if (!rawContent) return undefined
    const parsed = matter(rawContent)
    return {
      content: parsed.content,
      status: typeof parsed.data.status === 'string' ? parsed.data.status : undefined,
    }
  } catch (err) {
    logger.warn('automations.run.read_summary_failed', {
      appId,
      path,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}


// ---------------------------------------------------------------------------
// Hosting callback
// ---------------------------------------------------------------------------

interface CallbackPayload {
  status: 'succeeded' | 'failed' | 'cancelled'
  failureClass?: 'retryable' | 'non_retryable'
  reasonCode?: string
  error?: string
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  summary?: string
  summaryRef?: string
}

function getMgmtAiroBaseUrl(): string {
  const raw = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net'
  return raw.replace(/\/$/, '')
}

const CALLBACK_SIGNING_KEY = '__event_signing_key'
const CALLBACK_SIG_HEADER = 'X-Airo-Event-Sig'

function buildCallbackCanonical(appId: string, runId: string, status: string): string {
  return `${appId}\n${runId}\n${status}`
}

function computeCallbackSignature(key: string, canonical: string): string {
  return createHmac('sha256', key).update(canonical).digest('base64url')
}

// ── L2: Callback retry ───────────────────────────────────────────────────────
// Retry up to 3 times with exponential backoff (1s, 2s, 4s = 7s total).
// Kept short so total callback time stays well inside hosting's reconcile
// window (~5 min), giving retries room without racing the re-dispatch timer.
// Handles transient blips (rolling deploys, brief 503s) without the agent
// giving up on the first failure and letting hosting re-dispatch unnecessarily.
const CALLBACK_RETRY_DELAYS_MS = [1000, 2000, 4000]

async function postCallback(appId: string, runId: string, payload: CallbackPayload): Promise<void> {
  const url = `${getMgmtAiroBaseUrl()}/api/hosting/v1/apps/${appId}/agent/callback`

  // In api-key (local) mode S2S auth isn't available, but the local control
  // plane doesn't require a Bearer token, so skip the guard for localhost.
  const isLocalhost = getMgmtAiroBaseUrl().includes('localhost') || getMgmtAiroBaseUrl().includes('127.0.0.1')
  if (!isLocalhost && !isS2SAuthEnabled()) {
    logger.warn('automations.callback.s2s_disabled', { appId, runId })
    return
  }

  const signingKey = getNomadAllocConfigValue(CALLBACK_SIGNING_KEY, '')
  if (!signingKey && !isLocalhost) {
    logger.warn('automations.callback.no_signing_key', { appId, runId })
  }

  let lastError: string | undefined
  for (let attempt = 0; attempt <= CALLBACK_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      if (!isLocalhost) {
        const token = await getS2SToken()
        headers.Authorization = `sso-jwt ${token}`
      }
      if (signingKey) {
        const canonical = buildCallbackCanonical(appId, runId, payload.status)
        headers[CALLBACK_SIG_HEADER] = computeCallbackSignature(signingKey, canonical)
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ runId, ...payload }),
      })

      if (resp.ok) {
        logger.info('automations.callback.sent', { appId, runId, callbackStatus: payload.status, attempt })
        return
      }

      lastError = `HTTP ${resp.status}`
      logger.warn('automations.callback.http_error', { appId, runId, httpStatus: resp.status, attempt })

      // 4xx errors (except 429) are non-retryable — wrong endpoint, bad payload, etc.
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) break
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      logger.warn('automations.callback.fetch_error', { appId, runId, attempt, error: lastError })
    }

    if (attempt < CALLBACK_RETRY_DELAYS_MS.length) {
      await new Promise<void>(resolve => setTimeout(resolve, CALLBACK_RETRY_DELAYS_MS[attempt]))
    }
  }

  logger.error('automations.callback.failed_all_attempts', { appId, runId, callbackStatus: payload.status, lastError })
}
