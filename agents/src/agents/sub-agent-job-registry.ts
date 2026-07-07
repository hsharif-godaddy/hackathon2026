import type { ModelMessage } from 'ai'
import type { SubAgentResult } from './sub-agent-runner.js'
import type { FileAccess } from './sub-agent-transcript.js'
import { buildResultEnvelope, type ResultEnvelope, type ResultEnvelopeStatus } from './result-envelope.js'

export type JobStatus = ResultEnvelopeStatus

/**
 * What the registry's `await()` and `snapshot()` return to the orchestrator (no
 * transcript): the result envelope. See {@link ResultEnvelope} for the field
 * contract.
 */
export type JobResult = ResultEnvelope

export interface CachedSession {
  agent: string
  messages: ModelMessage[]
  filesRead: FileAccess[]
  filesWritten: FileAccess[]
  lastUsed: number
}

/** The detached work for one job. Receives the job's abort signal. */
export type JobRun = (signal: AbortSignal) => Promise<SubAgentResult>

interface Job {
  id: string
  agent: string
  title: string
  status: JobStatus
  promise: Promise<SubAgentResult>
  result?: SubAgentResult
  error?: string
  abort: AbortController
  startedAt: number
  finishedAt?: number
  /** Set once the job starts running: resolves it as a deliberate cancellation. */
  settleAborted?: () => void
}

interface QueueItem {
  job: Job
  run: JobRun
  resolve: (r: SubAgentResult) => void
}

export interface RegistryOptions {
  maxConcurrent?: number
  maxSessions?: number
  sessionTtlMs?: number
  taskTimeoutMs?: number
}

// taskTimeoutMs is a generous, configurable backstop: a hung worker surfaces as
// a timed-out envelope instead of blocking the orchestrator's await forever. Keep
// it well above the longest a legitimate run can take, so a slow-but-working
// sub-agent is never mislabeled timed-out — hence the generous default.
// Overridable per-registry and via SUBAGENT_TASK_TIMEOUT_MS at the singleton.
const DEFAULTS = { maxConcurrent: 4, maxSessions: 20, sessionTtlMs: 5 * 60 * 1000, taskTimeoutMs: 15 * 60 * 1000 }

// setTimeout clamps any delay above the 32-bit signed max to 1ms — firing almost
// immediately — so a taskTimeoutMs above this would silently turn the backstop
// into an instant timeout of every job. Cap it here regardless of source (env or
// per-registry opts); above this the backstop is effectively "no timeout" anyway.
const MAX_TASK_TIMEOUT_MS: number = 2_147_483_647

// Abort reason the backstop uses when it force-stops a hung worker. Shared with the
// run-agent consumer (which classifies a signalled abort as 'timeout' vs a user Stop
// by matching this exact reason) so the coupling is a single constant, not a bare
// string literal duplicated across the module boundary.
export const TASK_TIMEOUT_ABORT_REASON = 'task_timeout' as const

export class SubAgentJobRegistry {
  private readonly jobs = new Map<string, Job>()
  private readonly sessions = new Map<string, CachedSession>()
  private readonly queue: QueueItem[] = []
  private running = 0
  private seq = 0
  private readonly maxConcurrent: number
  private readonly maxSessions: number
  private readonly sessionTtlMs: number
  private readonly taskTimeoutMs: number

  constructor(opts: RegistryOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? DEFAULTS.maxConcurrent
    this.maxSessions = opts.maxSessions ?? DEFAULTS.maxSessions
    this.sessionTtlMs = opts.sessionTtlMs ?? DEFAULTS.sessionTtlMs
    // Floor a non-positive or NaN opt (e.g. a caller passing 0 for "no timeout") to
    // the default: passing it straight to setTimeout would coerce it to ~0ms and time
    // out every job on the next tick. Mirrors the env parser's `> 0` guard so both
    // configuration entry points agree.
    const requestedTimeout: number = opts.taskTimeoutMs ?? DEFAULTS.taskTimeoutMs
    this.taskTimeoutMs = requestedTimeout > 0 ? Math.min(requestedTimeout, MAX_TASK_TIMEOUT_MS) : DEFAULTS.taskTimeoutMs
  }

  dispatch(spec: { agent: string; title: string }, run: JobRun): string {
    const id = `job_${++this.seq}`
    const abort = new AbortController()
    let resolve!: (r: SubAgentResult) => void
    const promise = new Promise<SubAgentResult>(res => { resolve = res })
    const job: Job = {
      id, agent: spec.agent, title: spec.title,
      status: 'queued', promise, abort, startedAt: 0,
    }
    this.jobs.set(id, job)
    this.queue.push({ job, run, resolve })
    this.pump()
    return id
  }

  private pump(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!
      const { job, run, resolve } = item
      this.running++
      job.status = 'running'
      job.startedAt = Date.now()

      // `settled` guards the single-resolution invariant: the run-settle path and
      // the timeout path race, and exactly one must win. The loser (typically the
      // aborted run settling after a timeout already fired) is a no-op.
      let settled: boolean = false
      // The concurrency slot is freed exactly once, by whichever of the run-settle
      // path (`.finally`) or the timeout path reaches `releaseSlot` first. A worker
      // that ignores its abort signal never settles, so `.finally` never runs —
      // the timeout MUST free the slot itself, or `running` stays elevated and
      // `pump()` eventually starves every queued job.
      let slotReleased: boolean = false
      const releaseSlot = (): void => {
        if (slotReleased) return
        slotReleased = true
        this.running--
        this.pump()
      }
      const finalize = (result: SubAgentResult): void => {
        if (settled) return
        settled = true
        // Stamp finishedAt HERE (not in .finally): finalize resolves job.promise,
        // and the awaiter's toResult() reads durationMs the microtask after that
        // resolve — before .finally would run. Setting it here guarantees the
        // duration is present on the envelope the awaiter receives.
        if (job.finishedAt === undefined) job.finishedAt = Date.now()
        job.result = result
        resolve(result)
      }

      // Resolve a still-running job as a deliberate cancellation. abortAll() calls
      // this after signalling the abort so a worker that ignores its signal can't
      // block the awaiter — and so the backstop timer is cleared, releasing this
      // closure (and the registry it captures) instead of lingering for the full
      // timeout. Distinct from the timeout path: a user Stop is 'aborted', not a
      // 'timeout' involuntary failure.
      const settleAborted = (): void => {
        if (settled) return
        clearTimeout(timer)
        job.status = 'aborted'
        job.error = 'conversation aborted'
        finalize({ summary: job.error, artifacts: [], status: 'error' })
        releaseSlot()
      }
      job.settleAborted = settleAborted

      const timer: NodeJS.Timeout = setTimeout(() => {
        if (settled) return
        // If the signal was already aborted (e.g. a user Stop via abortAll whose
        // worker ignored the signal), this is a deliberate cancellation, not an
        // involuntary timeout — classify it 'aborted' to match the run-settle path's
        // aborted-vs-failure distinction rather than overwriting it with 'timeout'.
        const aborted: boolean = job.abort.signal.aborted
        job.status = aborted ? 'aborted' : 'timeout'
        job.error = aborted ? 'conversation aborted' : this.timeoutErrorMessage()
        finalize({ summary: job.error, artifacts: [], status: 'error' })
        // Ask the worker to stop; its run settles later and hits the no-op branch
        // above (the envelope is already the job's result). Free the slot NOW rather
        // than waiting for that settle — a hung worker may never settle, and
        // `.finally` (which also calls releaseSlot) would then never run.
        if (!aborted) job.abort.abort(TASK_TIMEOUT_ABORT_REASON)
        releaseSlot()
      }, this.taskTimeoutMs)
      // The backstop alone must not keep the process alive at shutdown.
      timer.unref?.()

      run(job.abort.signal)
        .then(result => {
          // Capture the session BEFORE the settled guard: a worker that finished
          // successfully in the race window just after the timeout fired still
          // settled with a real transcript, and caching it lets a later
          // continue/fromJobId retry resume instead of cold-restarting. (A truly
          // aborted worker resolves with no _session, so this is a no-op there.)
          this.captureSession(job.id, result)
          if (settled) return
          // The runner swallows AbortError into a resolved { status: 'error' },
          // so a deliberate cancellation lands here, not in .catch. Treat a
          // signalled abort as 'aborted' regardless of the returned status so
          // awaitAgents can report cancellation distinctly from a real failure.
          const aborted = job.abort.signal.aborted
          job.status = aborted ? 'aborted' : (result.status === 'error' ? 'error' : 'success')
          if (job.status !== 'success') job.error = result.summary
          finalize(stripSession(result))
        })
        .catch(err => {
          if (settled) return
          const aborted = job.abort.signal.aborted
          job.status = aborted ? 'aborted' : 'error'
          job.error = err instanceof Error ? err.message : String(err)
          finalize({ summary: job.error, artifacts: [], status: 'error' })
        })
        .finally(() => {
          clearTimeout(timer)
          releaseSlot()
        })
    }
  }

  async await(jobIds: string[]): Promise<JobResult[]> {
    return Promise.all(jobIds.map(async id => {
      const job = this.jobs.get(id)
      if (!job) {
        return buildResultEnvelope({ jobId: id, agent: 'unknown', title: '', status: 'error', error: `No job ${id}` })
      }
      await job.promise
      return this.toResult(job)
    }))
  }

  snapshot(): JobResult[] {
    return [...this.jobs.values()].map(j => this.toResult(j))
  }

  /**
   * A single job's current status, read directly from the job (O(1)). Prefer this
   * over `snapshot().find(...)` when only one job's status is needed — snapshot()
   * builds and validates an envelope for every job in the registry.
   */
  statusOf(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId)?.status
  }

  timeoutErrorMessage(): string {
    return `Sub-agent timed out after ${this.taskTimeoutMs}ms`
  }

  abortAll(): void {
    // Resolve queued (never-started) jobs first, so anyone awaiting them does not hang.
    for (const item of this.queue) {
      item.job.status = 'aborted'
      item.job.error = 'aborted before start'
      const synthetic: SubAgentResult = { summary: 'aborted before start', artifacts: [], status: 'error' }
      item.job.result = synthetic
      item.resolve(synthetic)
    }
    this.queue.length = 0
    // Abort jobs that are actually running: signal first so a well-behaved worker
    // stops, then settle the job as aborted ourselves. settleAborted clears the
    // backstop timer and resolves the awaiter immediately even if the worker ignores
    // its signal — rather than waiting out the full task timeout (which would also
    // mislabel a deliberate cancellation as 'timeout').
    for (const job of this.jobs.values()) {
      if (job.status !== 'running') continue
      job.abort.abort('conversation_aborted')
      job.settleAborted?.()
    }
  }

  getSession(jobId: string): CachedSession | undefined {
    const s = this.sessions.get(jobId)
    if (!s) return undefined
    if (Date.now() - s.lastUsed > this.sessionTtlMs) {
      this.sessions.delete(jobId)
      return undefined
    }
    s.lastUsed = Date.now()
    return s
  }

  /**
   * Resolve a re-entry target by agent type when fromJobId is omitted.
   * Returns the session ONLY when exactly one matches. Zero matches → caller
   * cold-runs; multiple matches are ambiguous and the caller must detect that
   * (via {@link sessionJobIdsByAgent}) and demand an explicit fromJobId rather
   * than have us silently guess which prior run to resume.
   */
  findLatestSessionByAgent(agent: string): { jobId: string; session: CachedSession } | undefined {
    const now = Date.now()
    // Expired sessions must not count (they'd resume stale context that
    // getSession would reject) — mirror the TTL filter used by getSession /
    // sessionJobIdsByAgent so all three agree on the same re-entry decision.
    const matches = [...this.sessions.entries()]
      .filter(([, s]) => s.agent === agent && now - s.lastUsed <= this.sessionTtlMs)
    if (matches.length !== 1) return undefined
    const match = matches[0]
    if (!match) return undefined
    const [jobId, session] = match
    return { jobId, session }
  }

  /**
   * Job ids of live (non-expired) cached sessions for an agent type. Used to
   * detect ambiguous re-entry (continue with no fromJobId + >1 candidate).
   */
  sessionJobIdsByAgent(agent: string): string[] {
    const now = Date.now()
    return [...this.sessions.entries()]
      .filter(([, s]) => s.agent === agent && now - s.lastUsed <= this.sessionTtlMs)
      .map(([jobId]) => jobId)
  }

  private captureSession(jobId: string, result: SubAgentResult): void {
     
    const s = result._session
    if (!s) return

    this.sessions.set(jobId, { agent: result._sessionAgent ?? 'unknown', ...s, lastUsed: Date.now() })
    while (this.sessions.size > this.maxSessions) {
      let oldestKey: string | undefined
      let oldest = Infinity
      for (const [k, v] of this.sessions) {
        if (v.lastUsed < oldest) { oldest = v.lastUsed; oldestKey = k }
      }
      if (oldestKey) this.sessions.delete(oldestKey)
      else break
    }
  }

  private toResult(job: Job): JobResult {
    return buildResultEnvelope({
      jobId: job.id,
      agent: job.agent,
      title: job.title,
      status: job.status,
      ...(job.result?.summary !== undefined && { summary: job.result.summary }),
      ...(job.result?.artifacts && { artifacts: job.result.artifacts }),
      ...(job.result?.usage && { usage: job.result.usage }),
      ...(job.finishedAt !== undefined && { durationMs: Math.max(0, job.finishedAt - job.startedAt) }),
      ...(job.error && { error: job.error }),
    })
  }
}

function stripSession(result: SubAgentResult): SubAgentResult {
  const { _session: _s, _sessionAgent: _sa, ...rest } = result
  return rest
}

export interface ManagerOptions {
  maxConversations?: number
  registry?: RegistryOptions
}

export class SubAgentJobRegistryManager {
  private readonly registries = new Map<string, SubAgentJobRegistry>()
  private readonly maxConversations: number
  private readonly registryOpts: RegistryOptions

  constructor(opts: ManagerOptions = {}) {
    this.maxConversations = opts.maxConversations ?? 50
    this.registryOpts = opts.registry ?? {}
  }

  get(conversationId: string): SubAgentJobRegistry {
    const existing = this.registries.get(conversationId)
    if (existing) {
      // Refresh LRU order (delete + re-set moves it to most-recently-used).
      this.registries.delete(conversationId)
      this.registries.set(conversationId, existing)
      return existing
    }
    const reg = new SubAgentJobRegistry(this.registryOpts)
    this.registries.set(conversationId, reg)
    while (this.registries.size > this.maxConversations) {
      const oldest = this.registries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.registries.get(oldest)?.abortAll()
      this.registries.delete(oldest)
    }
    return reg
  }

  has(conversationId: string): boolean {
    return this.registries.has(conversationId)
  }

  abort(conversationId: string): void {
    this.registries.get(conversationId)?.abortAll()
    this.registries.delete(conversationId)
  }
}

/** Ops override for the per-task timeout; falls back to the generous default. */
function resolveRegistryOptions(): RegistryOptions {
  const raw: string | undefined = process.env.SUBAGENT_TASK_TIMEOUT_MS
  // Strict decimal-integer parse: bare Number() leniently accepts '0x10', '1e-3',
  // '16abc' etc., silently turning a fat-fingered env value into a catastrophic
  // near-instant timeout. Anything that isn't a plain positive integer of ms falls
  // back to the generous default instead.
  const parsed: number = raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? { taskTimeoutMs: parsed } : {}
}

/** Process-wide singleton (mirrors interactiveSubAgentManager). */
export const subAgentJobRegistry = new SubAgentJobRegistryManager({ registry: resolveRegistryOptions() })
