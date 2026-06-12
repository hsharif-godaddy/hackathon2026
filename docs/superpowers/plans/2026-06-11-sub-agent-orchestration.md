# Sub-Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sub-agent parallelism reliable (independent of model tool-call batching), allow sub-agents to run in the background while the orchestrator keeps talking to the user, and enable fast re-entry into a prior sub-agent's context — all via one conversation-scoped job registry.

**Architecture:** `runAgent` becomes non-blocking: it registers a job in a per-conversation `SubAgentJobRegistry` and returns a `{ jobId }` handle immediately; the sub-agent runs detached. A new `awaitAgents` tool joins on jobs when the orchestrator needs results. Completed jobs cache their transcript in the same registry, keyed by `jobId`, so `runAgent(continue:true, fromJobId)` replays context for follow-up edits. Memory is bounded by per-conversation caps + idle TTL + a global LRU over conversations — teardown is **not** tied to socket disconnect, so jobs correctly survive the transport's 2-minute reconnection window.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, the `ai` SDK v6 (`ModelMessage`, `AgentWrapper.streamGenerate`), Express + Socket.IO (WS transport) and an SSE transport. Package: `@airo/agents` (`agents/`).

**Reference spec:** `docs/design-sub-agent-orchestration.md`.

**Scope of this plan (v1):** registry, non-blocking dispatch, `awaitAgents`, abort plumbing, re-entry, both transports' `conversationId` wiring, orchestrator `maxSteps`, and `core.md`. **Explicitly deferred** to a follow-up plan: auto-inject/server-initiated wake turns (needs a new `injectTurn` primitive — see spec "Deferred: auto-inject"); routing sub-agent progress events through the buffered conversation event channel for reconnect-replay (v1 keeps the existing socket-emitter, which simply drops progress events during a disconnect — a cosmetic degradation, not a correctness bug).

---

## Conventions for every task

- Run a single unit test file: `pnpm --filter @airo/agents test:unit "<path-fragment>"`.
- Run one test by name: `pnpm --filter @airo/agents test:unit -t "<test name>"`.
- All new `agents/src` files use ESM with `.js` import specifiers (e.g. `import { x } from './y.js'`), matching the existing code.
- Commit after each task with the message shown in its final step.

---

## File Structure

- **Create** `agents/src/agents/sub-agent-transcript.ts` — pure helpers: transcript extraction, truncation, file-access extraction, staleness detection. (Ported verbatim from PR #4807, with the `FileAccess` type relocated — see Task 1.)
- **Create** `agents/src/agents/sub-agent-job-registry.ts` — the per-conversation registry (jobs, FIFO concurrency, session cache with TTL/LRU) **and** the process-wide manager keyed by `conversationId`.
- **Modify** `agents/src/agents/sub-agent-runner.ts` — thread `AbortSignal`; capture transcript + file access into the result; add `continueExecution()` for re-entry.
- **Modify** `agents/src/tools/ai-lib-tools/run-agent.ts` — non-blocking dispatch returning `{ jobId }`; new `awaitAgentsAITool`; `continue`/`fromJobId` re-entry.
- **Modify** `agents/src/tools/ai-lib-tools/index.ts` — export + register `awaitAgents`.
- **Modify** `agents/src/agents/deep-build-agent.ts` — raise orchestrator `maxSteps`; add `awaitAgents` to its tool set.
- **Modify** `agents/src/prompts/deep-build/core.md` — dispatch → `awaitAgents` contract and re-entry guidance.
- **Modify** `agents/src/server/sse/MessageExecutionService.ts` — populate `context.metadata.conversationId` for registry lookup on the SSE path.

---

## Task 1: Port the transcript helpers (pure functions)

These are copied from PR #4807 unchanged except that `FileAccess` is defined locally here (the registry imports it from this module, not from a separate cache file).

**Files:**
- Create: `agents/src/agents/sub-agent-transcript.ts`
- Test: `agents/src/agents/__tests__/sub-agent-transcript.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// agents/src/agents/__tests__/sub-agent-transcript.test.ts
import { describe, it, expect } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  extractTranscript,
  extractFileAccess,
  truncateTranscript,
} from '../sub-agent-transcript.js'

function userMsg(text: string): ModelMessage {
  return { role: 'user', content: [{ type: 'text', text }] } as ModelMessage
}
function asstMsg(text: string): ModelMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] } as ModelMessage
}

describe('extractTranscript', () => {
  it('returns [] for empty steps', () => {
    expect(extractTranscript([], 'task')).toEqual([])
  })

  it('prepends the original task as a user message before the last step response', () => {
    const steps = [{ response: { messages: [asstMsg('done')] } }]
    const out = extractTranscript(steps, 'build home page')
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(userMsg('build home page'))
    expect(out[1]).toEqual(asstMsg('done'))
  })
})

describe('extractFileAccess', () => {
  it('collects unique read paths from readFile/directoryListing tool calls', () => {
    const steps = [
      { response: { messages: [] }, toolResults: [
        { toolName: 'readFile', args: { path: 'a.tsx' }, result: {} },
        { toolName: 'readFile', args: { path: 'a.tsx' }, result: {} },
        { toolName: 'str_replace_based_edit_tool', args: { path: 'b.css' }, result: {} },
      ] },
    ]
    const reads = extractFileAccess(steps, 'read')
    expect(reads.map(r => r.path)).toEqual(['a.tsx'])
  })

  it('collects write paths and supports file_path arg alias', () => {
    const steps = [
      { response: { messages: [] }, toolResults: [
        { toolName: 'str_replace_based_edit_tool', args: { file_path: 'c.tsx' }, result: {} },
      ] },
    ]
    const writes = extractFileAccess(steps, 'write')
    expect(writes.map(w => w.path)).toEqual(['c.tsx'])
  })
})

describe('truncateTranscript', () => {
  it('returns input unchanged when under the token cap', () => {
    const msgs = [userMsg('hi'), asstMsg('there')]
    expect(truncateTranscript(msgs)).toBe(msgs)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-transcript"`
Expected: FAIL — cannot find module `../sub-agent-transcript.js`.

- [ ] **Step 3: Create the implementation**

```typescript
// agents/src/agents/sub-agent-transcript.ts
import type { ModelMessage } from 'ai'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const MAX_TRANSCRIPT_TOKENS = 150_000
const CHARS_PER_TOKEN = 4

export interface FileAccess {
  path: string
  mtime: number
}

interface StepWithResponse {
  response: { messages: ModelMessage[] }
  toolCalls?: Array<{ toolName: string; args: Record<string, unknown> }>
  toolResults?: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>
}

const READ_TOOL_NAMES = new Set(['readFile', 'directoryListing'])
const WRITE_TOOL_NAMES = new Set(['writeFile', 'str_replace_based_edit_tool', 'fileEdit'])

export function extractTranscript(steps: StepWithResponse[], originalTask: string): ModelMessage[] {
  if (!steps || steps.length === 0) return []
  const lastStep = steps[steps.length - 1]
  if (!lastStep?.response?.messages) return []
  return [
    { role: 'user', content: [{ type: 'text', text: originalTask }] } as ModelMessage,
    ...lastStep.response.messages,
  ]
}

export function extractFileAccess(steps: StepWithResponse[], mode: 'read' | 'write'): FileAccess[] {
  const toolNames = mode === 'read' ? READ_TOOL_NAMES : WRITE_TOOL_NAMES
  const now = Date.now()
  const accesses: FileAccess[] = []
  const seen = new Set<string>()
  for (const step of steps) {
    const calls = step.toolResults ?? step.toolCalls ?? []
    for (const call of calls) {
      if (toolNames.has(call.toolName)) {
        const args = call.args as Record<string, unknown>
        const path = (args?.path as string) ?? (args?.file_path as string)
        if (path && !seen.has(path)) {
          seen.add(path)
          accesses.push({ path, mtime: now })
        }
      }
    }
  }
  return accesses
}

export function truncateTranscript(messages: ModelMessage[]): ModelMessage[] {
  const estimatedTokens = estimateTokenCount(messages)
  if (estimatedTokens <= MAX_TRANSCRIPT_TOKENS) return messages

  const turnStarts = findTurnBoundaries(messages)
  const KEEP_RECENT = 2
  if (turnStarts.length <= KEEP_RECENT + 1) return messages

  const firstTurnEnd = turnStarts[1] ?? messages.length
  const recentStart = turnStarts[turnStarts.length - KEEP_RECENT]

  return [
    ...messages.slice(0, firstTurnEnd),
    {
      role: 'user',
      content: [{ type: 'text', text: '[Earlier conversation turns omitted. Continue from your most recent state.]' }],
    } as ModelMessage,
    ...messages.slice(recentStart),
  ]
}

export async function detectStaleFiles(accesses: FileAccess[], appPath: string): Promise<string[]> {
  const stale: string[] = []
  for (const { path, mtime } of accesses) {
    try {
      const fullPath = resolve(appPath, path)
      const fileStat = await stat(fullPath)
      if (fileStat.mtimeMs > mtime) stale.push(path)
    } catch {
      stale.push(path)
    }
  }
  return stale
}

function findTurnBoundaries(messages: ModelMessage[]): number[] {
  const boundaries: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') boundaries.push(i)
  }
  return boundaries
}

function estimateTokenCount(messages: ModelMessage[]): number {
  let totalChars = 0
  for (const msg of messages) {
    totalChars += JSON.stringify(msg.content).length
  }
  return Math.ceil(totalChars / CHARS_PER_TOKEN)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-transcript"`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add agents/src/agents/sub-agent-transcript.ts agents/src/agents/__tests__/sub-agent-transcript.test.ts
git commit -m "feat(agents): add sub-agent transcript/staleness helpers"
```

---

## Task 2: The job registry — types and non-blocking dispatch

Build the registry incrementally. This task covers dispatch + the `promise`/status lifecycle, with the concurrency cap set high enough not to interfere (cap is exercised in Task 3).

**Files:**
- Create: `agents/src/agents/sub-agent-job-registry.ts`
- Test: `agents/src/agents/__tests__/sub-agent-job-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// agents/src/agents/__tests__/sub-agent-job-registry.test.ts
import { describe, it, expect } from 'vitest'
import { SubAgentJobRegistry } from '../sub-agent-job-registry.js'
import type { SubAgentResult } from '../sub-agent-runner.js'

function ok(summary: string): SubAgentResult {
  return { summary, artifacts: [], status: 'success' }
}
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

describe('SubAgentJobRegistry dispatch', () => {
  it('returns a jobId synchronously and starts in running state', () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const jobId = reg.dispatch({ agent: 'builder', title: 'Home' }, async () => ok('done'))
    expect(typeof jobId).toBe('string')
    const snap = reg.snapshot().find(j => j.jobId === jobId)
    expect(snap?.status).toBe('running')
  })

  it('await resolves to a structured success result', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const jobId = reg.dispatch({ agent: 'builder', title: 'Home' }, async () => ok('built home'))
    const [res] = await reg.await([jobId])
    expect(res).toMatchObject({ jobId, agent: 'builder', status: 'success', summary: 'built home' })
  })

  it('runs two dispatched jobs concurrently (no blocking between dispatches)', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const a = deferred<void>()
    const b = deferred<void>()
    let aStarted = false
    let bStarted = false
    const ja = reg.dispatch({ agent: 'builder', title: 'A' }, async () => { aStarted = true; await a.promise; return ok('a') })
    const jb = reg.dispatch({ agent: 'builder', title: 'B' }, async () => { bStarted = true; await b.promise; return ok('b') })
    // Both run functions have begun before either resolves → concurrency, not sequential.
    expect(aStarted && bStarted).toBe(true)
    a.resolve(); b.resolve()
    const results = await reg.await([ja, jb])
    expect(results.map(r => r.status)).toEqual(['success', 'success'])
  })

  it('await on a thrown run fn returns a structured error (does not reject)', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const jobId = reg.dispatch({ agent: 'design', title: 'D' }, async () => { throw new Error('boom') })
    const [res] = await reg.await([jobId])
    expect(res.status).toBe('error')
    expect(res.error).toBe('boom')
  })

  it('await on an unknown jobId returns a structured error', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const [res] = await reg.await(['nope'])
    expect(res.status).toBe('error')
    expect(res.error).toContain('nope')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-job-registry"`
Expected: FAIL — cannot find module `../sub-agent-job-registry.js`.

- [ ] **Step 3: Create the implementation**

```typescript
// agents/src/agents/sub-agent-job-registry.ts
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
          job.status = result.status === 'error' ? 'error' : 'success'
          if (result.status === 'error') job.error = result.summary
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
    this.queue.length = 0
    for (const job of this.jobs.values()) {
      if (job.status === 'running' || job.status === 'queued') job.abort.abort('conversation_aborted')
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

  /** Resolve a re-entry target by agent type when fromJobId is omitted. */
  findLatestSessionByAgent(agent: string): { jobId: string; session: CachedSession } | undefined {
    const matches = [...this.sessions.entries()].filter(([, s]) => s.agent === agent)
    if (matches.length !== 1) return undefined
    const [jobId, session] = matches[0]
    return { jobId, session }
  }

  private captureSession(jobId: string, result: SubAgentResult): void {
    const s = result._session
    if (!s) return
    this.sessions.set(jobId, { agent: result._sessionAgent ?? 'unknown', ...s, lastUsed: Date.now() })
    // LRU eviction by lastUsed.
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
  const { _session, _sessionAgent, ...rest } = result
  return rest
}
```

Note: `SubAgentResult._session` / `_sessionAgent` are added to the `SubAgentResult` interface in Task 4. This file references them; it will not typecheck until Task 4 extends the interface. That is expected — the registry unit tests in this task use results without `_session`, so they pass at runtime, but **run typecheck only after Task 4**.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-job-registry"`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add agents/src/agents/sub-agent-job-registry.ts agents/src/agents/__tests__/sub-agent-job-registry.test.ts
git commit -m "feat(agents): job registry with non-blocking dispatch + structured await"
```

---

## Task 3: Registry — FIFO concurrency cap and abort

**Files:**
- Modify: `agents/src/agents/sub-agent-job-registry.ts` (logic already present from Task 2; this task adds tests that pin the behavior)
- Test: `agents/src/agents/__tests__/sub-agent-job-registry.test.ts`

- [ ] **Step 1: Add failing tests**

```typescript
// append to agents/src/agents/__tests__/sub-agent-job-registry.test.ts
describe('SubAgentJobRegistry concurrency + abort', () => {
  it('queues jobs past the cap and drains them as slots free', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 1 })
    const order: string[] = []
    const d1 = deferred<void>()
    const j1 = reg.dispatch({ agent: 'builder', title: '1' }, async () => { order.push('start1'); await d1.promise; return ok('1') })
    const j2 = reg.dispatch({ agent: 'builder', title: '2' }, async () => { order.push('start2'); return ok('2') })
    // cap=1 → job2 must be queued, not started, while job1 runs.
    expect(reg.snapshot().find(j => j.jobId === j2)?.status).toBe('queued')
    expect(order).toEqual(['start1'])
    d1.resolve()
    await reg.await([j1, j2])
    expect(order).toEqual(['start1', 'start2'])
  })

  it('abortAll marks running jobs aborted and the signal fires', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    let sawAbort = false
    const jobId = reg.dispatch({ agent: 'builder', title: 'X' }, (signal) =>
      new Promise<SubAgentResult>((_, reject) => {
        signal.addEventListener('abort', () => { sawAbort = true; reject(new Error('aborted')) })
      }))
    reg.abortAll()
    const [res] = await reg.await([jobId])
    expect(sawAbort).toBe(true)
    expect(res.status).toBe('aborted')
  })
})
```

- [ ] **Step 2: Run to verify pass/fail**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-job-registry"`
Expected: PASS — the Task 2 implementation already handles the cap and abort. (If the queue test fails, the bug is in `pump()`; fix there.)

- [ ] **Step 3: Commit**

```bash
git add agents/src/agents/__tests__/sub-agent-job-registry.test.ts
git commit -m "test(agents): pin registry FIFO cap and abort semantics"
```

---

## Task 4: SubAgentRunner — abort signal + transcript capture

Thread an `AbortSignal` into `execute` and forward it to `streamGenerate`, and capture the transcript/file-access onto the result as internal `_session` fields.

**Files:**
- Modify: `agents/src/agents/sub-agent-runner.ts`
- Test: `agents/src/agents/__tests__/sub-agent-runner-session.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// agents/src/agents/__tests__/sub-agent-runner-session.test.ts
import { describe, it, expect } from 'vitest'
import type { SubAgentResult } from '../sub-agent-runner.js'

describe('SubAgentResult session fields', () => {
  it('exposes optional _session and _sessionAgent for re-entry capture', () => {
    // Type-level contract: assigning these must compile.
    const r: SubAgentResult = {
      summary: 's', artifacts: [], status: 'success',
      _session: { messages: [], filesRead: [], filesWritten: [] },
      _sessionAgent: 'design',
    }
    expect(r._sessionAgent).toBe('design')
    expect(r._session?.messages).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-runner-session"`
Expected: FAIL — `_session`/`_sessionAgent` are not on `SubAgentResult`.

- [ ] **Step 3: Extend `SubAgentResult` and thread the signal**

In `agents/src/agents/sub-agent-runner.ts`:

Add the import near the top:

```typescript
import type { ModelMessage } from 'ai'
import { extractTranscript, extractFileAccess, truncateTranscript } from './sub-agent-transcript.js'
import type { FileAccess } from './sub-agent-transcript.js'
```

Extend the `SubAgentResult` interface:

```typescript
export interface SubAgentResult {
  summary: string
  artifacts: string[]
  status: 'success' | 'error'
  docPath?: string
  visualOutputs?: VisualOutput[]
  /** Internal: captured transcript for re-entry. Stripped before returning to the model. */
  _session?: { messages: ModelMessage[]; filesRead: FileAccess[]; filesWritten: FileAccess[] }
  /** Internal: agent id for the captured session. */
  _sessionAgent?: string
}
```

Change the `execute` signature to accept a signal (add a fifth optional parameter):

```typescript
  async execute(
    task: string,
    inputs: Record<string, string | string[]>,
    onEvent: (event: SubAgentEvent) => void,
    executionContext?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<SubAgentResult> {
```

Forward the signal at the `streamGenerate` call site (currently `sub-agent-runner.ts:159`):

```typescript
      const streamResult = await agent.streamGenerate(userMessage, {
        executionContext,
        ...(signal && { abortSignal: signal }),
      })
```

Capture the session right after `getFinalResult()` resolves. Find the block that reads `fullResult.steps`, and after the existing `artifacts` extraction, before `return { summary: fullText, ... }`, add:

```typescript
      const steps = (Array.isArray(fullResult.steps) ? fullResult.steps : []) as Array<{
        response: { messages: ModelMessage[] }
        toolResults?: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>
      }>
      const transcript = truncateTranscript(extractTranscript(steps, userMessage))
      const session = {
        messages: transcript,
        filesRead: extractFileAccess(steps, 'read'),
        filesWritten: extractFileAccess(steps, 'write'),
      }
```

Then add `_session` and `_sessionAgent` to the success return object:

```typescript
      return {
        summary: fullText,
        artifacts,
        status: 'success',
        ...(docPath && { docPath }),
        ...(visualOutputs.length > 0 && { visualOutputs }),
        _session: session,
        _sessionAgent: id,
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-runner-session"`
Expected: PASS.

Then typecheck the registry + runner together (Task 2's file references these fields):

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/src/agents/sub-agent-runner.ts agents/src/agents/__tests__/sub-agent-runner-session.test.ts
git commit -m "feat(agents): runner accepts abort signal + captures re-entry transcript"
```

---

## Task 5: SubAgentRunner — `continueExecution()` for re-entry

Add a method that replays a prior transcript as history, with a staleness warning prepended to the new task.

**Files:**
- Modify: `agents/src/agents/sub-agent-runner.ts`
- Test: `agents/src/agents/__tests__/sub-agent-runner-continue.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// agents/src/agents/__tests__/sub-agent-runner-continue.test.ts
import { describe, it, expect } from 'vitest'
import { buildContinuationMessage } from '../sub-agent-runner.js'

describe('buildContinuationMessage', () => {
  it('returns the bare task when no files are stale', () => {
    expect(buildContinuationMessage('fix contrast', [])).toBe('fix contrast')
  })

  it('prepends a re-read warning listing stale files', () => {
    const msg = buildContinuationMessage('fix contrast', ['src/a.css', 'src/b.tsx'])
    expect(msg).toContain('src/a.css')
    expect(msg).toContain('src/b.tsx')
    expect(msg.toLowerCase()).toContain('re-read')
    expect(msg).toContain('fix contrast')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-runner-continue"`
Expected: FAIL — `buildContinuationMessage` is not exported.

- [ ] **Step 3: Implement the helper and the method**

In `agents/src/agents/sub-agent-runner.ts`, add the exported helper (top-level, near `buildUserMessage`):

```typescript
export function buildContinuationMessage(task: string, staleFiles: string[]): string {
  if (staleFiles.length === 0) return task
  const list = staleFiles.map(f => `- ${f}`).join('\n')
  return `Note: these files have changed since you last read or wrote them — re-read them before relying on your prior knowledge:\n${list}\n\n${task}`
}
```

Add the `continueExecution` method to the `SubAgentRunner` class. It mirrors `execute` but passes `messages` (prior transcript) to `streamGenerate`. To avoid duplicating the streaming/event/capture logic, refactor the body of `execute` after `AgentWrapper` construction into a private `runStream(agent, userMessage, onEvent, executionContext, signal, priorMessages?)` and have both `execute` and `continueExecution` call it. Concretely:

```typescript
  async continueExecution(
    priorMessages: ModelMessage[],
    task: string,
    inputs: Record<string, string | string[]>,
    onEvent: (event: SubAgentEvent) => void,
    executionContext?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<SubAgentResult> {
    const { id, name, system, tools, model, maxSteps, temperature, maxOutputTokens, visualOutputExtractors, enablePromptCaching } = this.config
    onEvent({ event: 'started', agent: name, detail: 'Resuming prior context' })
    const languageModel = await getModel(model)
    const agent = new AgentWrapper({
      id, name, system, model: languageModel, modelName: model, tools, maxSteps,
      temperature: temperature ?? 0.3,
      maxOutputTokens: maxOutputTokens ?? 16000,
      enablePromptCaching: enablePromptCaching ?? false,
      logger,
    }, skillToolManager)
    const userMessage = buildUserMessage(task, inputs)
    const streamResult = await agent.streamGenerate(userMessage, {
      messages: priorMessages,
      executionContext,
      ...(signal && { abortSignal: signal }),
    })
    return this.collectStream(streamResult, userMessage, onEvent, priorMessages)
  }
```

Where `collectStream(streamResult, userMessage, onEvent, priorMessages?)` is the extracted method containing the existing `for await (textStream)` loop, `getFinalResult()`, usage emission, artifact extraction, and session capture from Task 4. When `priorMessages` is provided, the captured `_session.messages` must be `truncateTranscript([...priorMessages, ...newResponseMessages])` so the cache accumulates. Implement that by building the transcript as:

```typescript
    const responseMsgs = steps[steps.length - 1]?.response?.messages ?? []
    const fullTranscript = priorMessages
      ? [...priorMessages, ...responseMsgs]
      : extractTranscript(steps, userMessage)
    const transcript = truncateTranscript(fullTranscript)
```

(Replace the inline transcript construction added in Task 4 with this conditional version inside `collectStream`.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-runner-continue"`
Then: `pnpm --filter @airo/agents test:unit "sub-agent-runner-session"` (ensure the refactor didn't regress capture).
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add agents/src/agents/sub-agent-runner.ts agents/src/agents/__tests__/sub-agent-runner-continue.test.ts
git commit -m "feat(agents): runner continueExecution replays cached transcript with staleness warning"
```

---

## Task 6: The registry manager (process-wide, keyed by conversationId)

A singleton that hands out per-conversation registries, bounded by a global LRU over conversations so memory can't grow without limit. No socket/disconnect coupling.

**Files:**
- Modify: `agents/src/agents/sub-agent-job-registry.ts`
- Test: `agents/src/agents/__tests__/sub-agent-job-registry-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// agents/src/agents/__tests__/sub-agent-job-registry-manager.test.ts
import { describe, it, expect } from 'vitest'
import { SubAgentJobRegistryManager } from '../sub-agent-job-registry.js'

describe('SubAgentJobRegistryManager', () => {
  it('returns the same registry instance for a conversationId', () => {
    const mgr = new SubAgentJobRegistryManager({ maxConversations: 10 })
    const a = mgr.get('conv-1')
    const b = mgr.get('conv-1')
    expect(a).toBe(b)
  })

  it('evicts the least-recently-used conversation past the cap', () => {
    const mgr = new SubAgentJobRegistryManager({ maxConversations: 2 })
    const r1 = mgr.get('c1')
    mgr.get('c2')
    mgr.get('c1') // touch c1 so c2 is now LRU
    mgr.get('c3') // evicts c2
    expect(mgr.get('c1')).toBe(r1)        // still present
    expect(mgr.has('c2')).toBe(false)      // evicted
  })

  it('abort(conversationId) aborts that conversation\'s jobs and drops it', () => {
    const mgr = new SubAgentJobRegistryManager({ maxConversations: 10 })
    mgr.get('c1')
    mgr.abort('c1')
    expect(mgr.has('c1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-job-registry-manager"`
Expected: FAIL — `SubAgentJobRegistryManager` not exported.

- [ ] **Step 3: Implement the manager + singleton**

Append to `agents/src/agents/sub-agent-job-registry.ts`:

```typescript
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
      // Refresh LRU order.
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
```

Note: `Map` iteration order is insertion order, so deleting `keys().next().value` evicts the least-recently-inserted; `get()` re-inserts on access to make it least-recently-*used*.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "sub-agent-job-registry-manager"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/src/agents/sub-agent-job-registry.ts agents/src/agents/__tests__/sub-agent-job-registry-manager.test.ts
git commit -m "feat(agents): conversation-scoped registry manager with global LRU"
```

---

## Task 7: Non-blocking `runAgent` + `awaitAgents` tools

Rewrite `runAgent` to dispatch into the registry and return a handle; add `awaitAgents`. Preserve the existing event-emit and usage-stats wiring inside the dispatched run function.

**Files:**
- Modify: `agents/src/tools/ai-lib-tools/run-agent.ts`
- Test: `agents/src/tools/ai-lib-tools/__tests__/run-agent.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// agents/src/tools/ai-lib-tools/__tests__/run-agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { subAgentJobRegistry } from '../../../agents/sub-agent-job-registry.js'

// Stub the runner so the test doesn't hit a real model.
vi.mock('../../../agents/sub-agent-runner.js', () => {
  return {
    SubAgentRunner: class {
      async execute() {
        return { summary: 'built', artifacts: ['index.html'], status: 'success' }
      }
    },
  }
})
vi.mock('../../../agents/sub-agents/index.js', () => ({
  getSubAgentConfig: async () => ({ id: 'builder', name: 'Builder', system: '', tools: {}, model: 'm', maxSteps: 1 }),
}))

import { runAgentAITool, awaitAgentsAITool } from '../run-agent.js'

const ctx = { metadata: { appPath: '/tmp/app', conversationId: 'conv-test', appId: 'app1' } }

describe('runAgent (non-blocking) + awaitAgents', () => {
  it('returns a jobId immediately without the sub-agent result', async () => {
    const out = await (runAgentAITool as any).execute(
      { agent: 'builder', title: 'Home', task: 'build', inputs: {}, mode: 'background' },
      ctx
    )
    expect(out.jobId).toMatch(/^job_/)
    expect(out.status).toBe('running')
    expect(out.summary).toBeUndefined()
  })

  it('awaitAgents returns the structured result for that job', async () => {
    const disp = await (runAgentAITool as any).execute(
      { agent: 'builder', title: 'Home', task: 'build', inputs: {}, mode: 'background' },
      ctx
    )
    const out = await (awaitAgentsAITool as any).execute({ jobIds: [disp.jobId] }, ctx)
    expect(out.results[0]).toMatchObject({ jobId: disp.jobId, status: 'success', summary: 'built' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "run-agent"`
Expected: FAIL — `awaitAgentsAITool` not exported / `runAgent` still returns the full result.

- [ ] **Step 3: Rewrite the dispatch path**

In `agents/src/tools/ai-lib-tools/run-agent.ts`:

Add imports:

```typescript
import { subAgentJobRegistry } from '../../agents/sub-agent-job-registry.js'
```

Replace the background branch (everything from `logger.info('runAgent.dispatching', …)` through the final `return result`) with non-blocking dispatch. The `emitEvent` closure and the usage-stats block stay exactly as they are today — they move inside the dispatched run function. The new shape:

```typescript
    logger.info('runAgent.dispatching', { agent, appId, task: task.slice(0, 100) })

    const conversationId = (context?.metadata?.conversationId as string) ?? 'unknown'
    const registry = subAgentJobRegistry.get(conversationId)

    const subAgentConfig = await getSubAgentConfig(agent as BackgroundAgentName, appPath)
    const runner = new SubAgentRunner(subAgentConfig)

    const emitEvent = (event: SubAgentEvent): void => { /* UNCHANGED — keep existing body */ }

    const jobId = registry.dispatch({ agent, title: input.title }, async (signal) => {
      const result = await runner.execute(
        task, inputs, emitEvent,
        context as unknown as Record<string, unknown> | undefined,
        signal
      )
      if (result.status === 'error') {
        logger.error('runAgent.failed', { agent, appId, summary: result.summary?.slice(0, 200) })
      } else {
        logger.info('runAgent.completed', { agent, appId, artifactCount: result.artifacts.length })
      }
      return result
    })

    return { jobId, agent, title: input.title, status: registry.snapshot().find(j => j.jobId === jobId)?.status ?? 'running' }
```

Add the `awaitAgents` tool at the end of the file:

```typescript
export const awaitAgentsAITool: Tool = createTool(
  `Wait for one or more previously dispatched sub-agent jobs to finish, then return their results.

Pass the jobIds returned by earlier runAgent calls. Blocks until all listed jobs complete. Returns each job's status ("success" | "error" | "aborted"), summary, artifacts, and (on failure) error. A failed job is reported as a structured error result — it does NOT throw — so you can decide whether to retry or route around it.`,
  z.object({
    jobIds: z.array(z.string()).min(1).describe('Job IDs returned by prior runAgent dispatches'),
  }),
  async (input, context) => {
    const conversationId = (context?.metadata?.conversationId as string) ?? 'unknown'
    const registry = subAgentJobRegistry.get(conversationId)
    const results = await registry.await(input.jobIds)
    return { results }
  }
)
```

Update the tool description string for `runAgent` to document the new contract: it returns `{ jobId }` immediately and the caller must `awaitAgents([jobId])` before depending on results; parallelism comes from dispatching multiple jobs and awaiting them together.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "run-agent"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/run-agent.ts agents/src/tools/ai-lib-tools/__tests__/run-agent.test.ts
git commit -m "feat(agents): non-blocking runAgent + awaitAgents tool"
```

---

## Task 8: Re-entry — `continue` / `fromJobId` in `runAgent`

**Files:**
- Modify: `agents/src/tools/ai-lib-tools/run-agent.ts`
- Test: `agents/src/tools/ai-lib-tools/__tests__/run-agent-reentry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// agents/src/tools/ai-lib-tools/__tests__/run-agent-reentry.test.ts
import { describe, it, expect, vi } from 'vitest'

const continueSpy = vi.fn(async () => ({ summary: 'tweaked', artifacts: [], status: 'success' }))
vi.mock('../../../agents/sub-agent-runner.js', () => ({
  SubAgentRunner: class {
    async execute() { return { summary: 'fresh', artifacts: [], status: 'success' } }
    continueExecution = continueSpy
  },
}))
vi.mock('../../../agents/sub-agents/index.js', () => ({
  getSubAgentConfig: async () => ({ id: 'design', name: 'Design', system: '', tools: {}, model: 'm', maxSteps: 1 }),
}))

import { runAgentAITool, awaitAgentsAITool } from '../run-agent.js'
import { subAgentJobRegistry } from '../../../agents/sub-agent-job-registry.js'

const ctx = { metadata: { appPath: '/tmp/app', conversationId: 'conv-reentry', appId: 'app1' } }

describe('runAgent re-entry', () => {
  it('falls back to a cold run when the referenced session is absent', async () => {
    const out = await (runAgentAITool as any).execute(
      { agent: 'design', title: 'Tweak', task: 'fix contrast', inputs: {}, mode: 'background', continue: true, fromJobId: 'job_missing' },
      ctx
    )
    const joined = await (awaitAgentsAITool as any).execute({ jobIds: [out.jobId] }, ctx)
    expect(joined.results[0].status).toBe('success')
    expect(continueSpy).not.toHaveBeenCalled() // cold run, not continuation
  })

  it('uses continueExecution when a cached session exists for fromJobId', async () => {
    const reg = subAgentJobRegistry.get('conv-reentry')
    // Seed a cached session directly.
    ;(reg as any).sessions.set('job_seed', {
      agent: 'design', messages: [{ role: 'user', content: [{ type: 'text', text: 'orig' }] }],
      filesRead: [], filesWritten: [], lastUsed: Date.now(),
    })
    const out = await (runAgentAITool as any).execute(
      { agent: 'design', title: 'Tweak', task: 'fix contrast', inputs: {}, mode: 'background', continue: true, fromJobId: 'job_seed' },
      ctx
    )
    await (awaitAgentsAITool as any).execute({ jobIds: [out.jobId] }, ctx)
    expect(continueSpy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "run-agent-reentry"`
Expected: FAIL — `continue`/`fromJobId` not in the schema; no re-entry branch.

- [ ] **Step 3: Implement re-entry**

In `run-agent.ts`, extend the zod schema with:

```typescript
    continue: z.boolean().default(false).describe('Re-enter a prior sub-agent run, replaying its context instead of starting cold. Use for follow-up edits.'),
    fromJobId: z.string().optional().describe('The jobId of the prior run to continue. If omitted and exactly one completed job of this agent type exists, that one is used.'),
```

Add `detectStaleFiles` and `buildContinuationMessage` imports:

```typescript
import { detectStaleFiles } from '../../agents/sub-agent-transcript.js'
import { SubAgentRunner, buildContinuationMessage, type SubAgentEvent } from '../../agents/sub-agent-runner.js'
```

Replace the single-line dispatch `run` function with one that branches on re-entry. The resolution happens **inside** the run function (so it runs detached and can do async staleness IO):

```typescript
    const { continue: wantContinue, fromJobId } = input
    const jobId = registry.dispatch({ agent, title: input.title }, async (signal) => {
      let session = undefined
      if (wantContinue) {
        if (fromJobId) {
          session = registry.getSession(fromJobId)
        } else {
          session = registry.findLatestSessionByAgent(agent)?.session
        }
      }

      if (session) {
        const stale = await detectStaleFiles([...session.filesRead, ...session.filesWritten], appPath)
        const contextual = buildContinuationMessage(task, stale)
        return runner.continueExecution(
          session.messages, contextual, inputs, emitEvent,
          context as unknown as Record<string, unknown> | undefined, signal
        )
      }

      // Cold run (no session, or re-entry requested but session gone → graceful fallback).
      return runner.execute(
        task, inputs, emitEvent,
        context as unknown as Record<string, unknown> | undefined, signal
      )
    })

    return { jobId, agent, title: input.title, status: registry.snapshot().find(j => j.jobId === jobId)?.status ?? 'running' }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "run-agent-reentry"`
Then: `pnpm --filter @airo/agents test:unit "run-agent"` (no regression).
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/run-agent.ts agents/src/tools/ai-lib-tools/__tests__/run-agent-reentry.test.ts
git commit -m "feat(agents): runAgent continue/fromJobId re-entry with cold-run fallback"
```

---

## Task 9: Register `awaitAgents` and wire it into the orchestrator

**Files:**
- Modify: `agents/src/tools/ai-lib-tools/index.ts:57,108,171` (export/import/registry map — match the existing `runAgent` pattern)
- Modify: `agents/src/agents/deep-build-agent.ts:60` (tool set + `maxSteps`)
- Test: `agents/src/tools/ai-lib-tools/__tests__/tool-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// agents/src/tools/ai-lib-tools/__tests__/tool-registry.test.ts
import { describe, it, expect } from 'vitest'
import { allAILibTools } from '../index.js'

describe('tool registry', () => {
  it('registers awaitAgents alongside runAgent', () => {
    expect(allAILibTools.runAgent).toBeDefined()
    expect(allAILibTools.awaitAgents).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "tool-registry"`
Expected: FAIL — `awaitAgents` not in the map.

- [ ] **Step 3: Wire it up**

In `agents/src/tools/ai-lib-tools/index.ts`, mirror the three `runAgent` lines:
- near line 57: `export { runAgentAITool, awaitAgentsAITool } from './run-agent.js'`
- near line 108: `import { runAgentAITool, awaitAgentsAITool } from './run-agent.js'`
- near line 171, in the tools map: add `awaitAgents: awaitAgentsAITool,` next to `runAgent: runAgentAITool,`

In `agents/src/agents/deep-build-agent.ts`:
- Add `awaitAgents` to the orchestrator's tool set wherever `runAgent` is included (search for `runAgent` in that file and add the sibling key).
- Change `maxSteps: 50` (line 60) to `maxSteps: 100`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "tool-registry"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/index.ts agents/src/agents/deep-build-agent.ts agents/src/tools/ai-lib-tools/__tests__/tool-registry.test.ts
git commit -m "feat(agents): register awaitAgents; raise orchestrator maxSteps to 100"
```

---

## Task 10: Populate `conversationId` on the SSE path

The registry keys on `context.metadata.conversationId`. The WS path already populates it (`attachConversationId`). Ensure the SSE path does too, so PaaS uses the same registry instance per conversation.

**Files:**
- Modify: `agents/src/server/sse/MessageExecutionService.ts` (near `1697`–`1741`, where `appPath` and `eventEmitter` are injected onto `execMeta`)

- [ ] **Step 1: Inspect the current injection**

Read `agents/src/server/sse/MessageExecutionService.ts:1690-1745`. Confirm there is an `execMeta` (or equivalently named) metadata object that already gets `appPath` and `eventEmitter`, and find the variable holding the conversation id for this SSE request (search upward for `conversationId`).

- [ ] **Step 2: Add the field**

In the same block that sets `appPath` (around line 1711), add the conversation id (use the SSE request's existing conversation id variable — name it as found in Step 1):

```typescript
        ...(conversationId && { conversationId }),
```

If no conversation id exists on the SSE path, fall back to the request/session id already used for that request so each PaaS conversation maps to a stable registry key. Document the chosen source in a one-line comment.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts
git commit -m "feat(agents): populate conversationId for sub-agent registry on SSE path"
```

---

## Task 11: Update the orchestrator prompt (`core.md`)

**Files:**
- Modify: `agents/src/prompts/deep-build/core.md` (lines ~22, ~38, ~67–95, ~127)

- [ ] **Step 1: Replace the batching guidance**

Replace the line that states "Multiple `runAgent` calls in one response execute concurrently" (≈ line 67) and the Turn examples (≈ 88–95) with the dispatch → await contract. Use this content:

```markdown
## Dispatching sub-agents

`runAgent` is non-blocking: it returns a `{ jobId }` immediately and the sub-agent runs in the background. You do NOT need to put multiple calls in one message to get parallelism — dispatch each job whenever you decide to, in any order, and they all run concurrently.

To use a job's results, call `awaitAgents([jobId, ...])`. It blocks until those jobs finish and returns each one's `status`, `summary`, and `artifacts`. A failed job comes back as `{ status: "error", error }` — it does not abort your turn; decide whether to retry or proceed.

**Parallel phase:**
```
runAgent(media,   "Source all images")         → { jobId: "job_1" }
runAgent(builder, "Foundation: tokens, shell") → { jobId: "job_2" }
awaitAgents(["job_1", "job_2"])                → results for both
runAgent(builder, "Home + Menu pages")         → { jobId: "job_3" }
runAgent(builder, "About + Events pages")      → { jobId: "job_4" }
awaitAgents(["job_3", "job_4"])
```

**Background work during an interview:** dispatch the long job, then run the interview; collect afterward.
```
runAgent(design, "Build the design system")    → { jobId: "job_5" }   (runs in background)
runAgent(interview, mode: "interactive", ...)  (you talk to the user while design builds)
awaitAgents(["job_5"])                          (collect once the interview returns)
```

**Follow-up edits (re-entry):** to tweak something a sub-agent just built, re-enter its context instead of starting cold:
```
runAgent(design, "fix the contrast on the hero", continue: true, fromJobId: "job_5")
```
Re-entry is much faster because the agent keeps the context it already built. If the prior context is no longer available it falls back to a normal cold run automatically.
```

Also update the table row at line ~22 and the bullet at ~38 so they reference "dispatch + awaitAgents" rather than "in parallel in one response," and the line ~127 flow likewise.

- [ ] **Step 2: Verify no stale "one response" phrasing remains**

Run: `grep -n "one response\|same turn\|same message" agents/src/prompts/deep-build/core.md`
Expected: no remaining references implying parallelism requires a single message. (Prompts are excluded from prettier — no formatting step.)

- [ ] **Step 3: Commit**

```bash
git add agents/src/prompts/deep-build/core.md
git commit -m "docs(prompt): deep-build dispatch/awaitAgents contract + re-entry guidance"
```

---

## Task 12: Full verification

- [ ] **Step 1: Unit tests for the whole package**

Run: `pnpm --filter @airo/agents test:unit "sub-agent"` then `pnpm --filter @airo/agents test:unit "run-agent"`
Expected: all PASS.

- [ ] **Step 2: Typecheck, lint, build**

Run:
```bash
pnpm --filter @airo/agents typecheck
pnpm --filter @airo/agents lint
pnpm --filter @airo/agents build
```
Expected: all PASS.

- [ ] **Step 3: Manual smoke (local dev)**

Per `CLAUDE.md`: `pnpm run dev`, create an app, run a deep build, and confirm in logs (`runAgent.dispatching` / `runAgent.completed`) that multiple builders overlap in time (dispatched across separate steps yet running concurrently), then request a follow-up tweak and confirm the re-entry path (continuation, fewer tool calls). Use the local-dev-browser skill if helpful.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(agents): sub-agent orchestration v1 verification cleanup"
```

---

## Self-Review notes (already reconciled)

- **Spec coverage:** registry (Tasks 2,3,6) · non-blocking dispatch + awaitAgents (Task 7) · abort plumbing (Tasks 3,4) · re-entry with jobId keying + cold fallback (Tasks 5,8) · staleness/truncation reuse from #4807 (Tasks 1,5) · both transports' conversationId (WS already; SSE Task 10) · maxSteps + prompt contract (Tasks 9,11). Deferred items (auto-inject, event-channel replay) are called out in the header, not silently dropped.
- **Type consistency:** `_session`/`_sessionAgent` defined in Task 4 and consumed by the registry's `captureSession` (Task 2) — Task 2's file is noted as typecheck-deferred until Task 4. `JobResult`, `CachedSession`, `FileAccess`, `JobRun` names are used consistently across Tasks 2/6/7/8.
- **No placeholders:** every code step contains complete code; the only "inspect first" step (Task 10 Step 1) is a read to find an existing variable name on a file too large to quote wholesale, immediately followed by the exact edit.
