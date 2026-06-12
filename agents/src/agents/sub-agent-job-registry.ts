import type { ModelMessage } from 'ai'
import type { SubAgentResult } from './sub-agent-runner.js'
import type { FileAccess } from './sub-agent-transcript.js'

export type JobStatus = 'queued' | 'running' | 'success' | 'error' | 'aborted'

/** What awaitAgents/checkAgents return to the orchestrator (no transcript). */
export interface JobResult {
  jobId: string
  agent: string
  title: string
  status: JobStatus
  summary?: string
  artifacts?: string[]
  error?: string
}

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
}

const DEFAULTS = { maxConcurrent: 4, maxSessions: 20, sessionTtlMs: 5 * 60 * 1000 }

export class SubAgentJobRegistry {
  private readonly jobs = new Map<string, Job>()
  private readonly sessions = new Map<string, CachedSession>()
  private readonly queue: QueueItem[] = []
  private running = 0
  private seq = 0
  private readonly maxConcurrent: number
  private readonly maxSessions: number
  private readonly sessionTtlMs: number

  constructor(opts: RegistryOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? DEFAULTS.maxConcurrent
    this.maxSessions = opts.maxSessions ?? DEFAULTS.maxSessions
    this.sessionTtlMs = opts.sessionTtlMs ?? DEFAULTS.sessionTtlMs
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
      run(job.abort.signal)
        .then(result => {
          // The runner swallows AbortError into a resolved { status: 'error' },
          // so a deliberate cancellation lands here, not in .catch. Treat a
          // signalled abort as 'aborted' regardless of the returned status so
          // awaitAgents can report cancellation distinctly from a real failure.
          const aborted = job.abort.signal.aborted
          job.status = aborted ? 'aborted' : (result.status === 'error' ? 'error' : 'success')
          if (job.status !== 'success') job.error = result.summary
          this.captureSession(job.id, result)
          job.result = stripSession(result)
          resolve(job.result)
        })
        .catch(err => {
          const aborted = job.abort.signal.aborted
          job.status = aborted ? 'aborted' : 'error'
          job.error = err instanceof Error ? err.message : String(err)
          const synthetic: SubAgentResult = { summary: job.error, artifacts: [], status: 'error' }
          job.result = synthetic
          resolve(synthetic)
        })
        .finally(() => {
          job.finishedAt = Date.now()
          this.running--
          this.pump()
        })
    }
  }

  async await(jobIds: string[]): Promise<JobResult[]> {
    return Promise.all(jobIds.map(async id => {
      const job = this.jobs.get(id)
      if (!job) {
        return { jobId: id, agent: 'unknown', title: '', status: 'error' as JobStatus, error: `No job ${id}` }
      }
      await job.promise
      return this.toResult(job)
    }))
  }

  snapshot(): JobResult[] {
    return [...this.jobs.values()].map(j => this.toResult(j))
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
    // Abort jobs that are actually running; their run fn rejects and the catch in pump marks them 'aborted'.
    for (const job of this.jobs.values()) {
      if (job.status === 'running') job.abort.abort('conversation_aborted')
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
    return {
      jobId: job.id,
      agent: job.agent,
      title: job.title,
      status: job.status,
      ...(job.result?.summary !== undefined && { summary: job.result.summary }),
      ...(job.result?.artifacts && { artifacts: job.result.artifacts }),
      ...(job.error && { error: job.error }),
    }
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

/** Process-wide singleton (mirrors interactiveSubAgentManager). */
export const subAgentJobRegistry = new SubAgentJobRegistryManager()
