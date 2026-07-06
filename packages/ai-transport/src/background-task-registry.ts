/**
 * Per-turn registry for background tasks that should be awaited before the agent
 * loop finalizes. Tools register their `done` promises here; the loop drains
 * settled outcomes mid-iteration and blocks on pending ones at turn end.
 */

export interface BackgroundTaskOutcome {
  status: 'completed' | 'failed' | 'timeout'
  taskId: string
  toolName: string
  result?: unknown
  error?: string
}

export interface BackgroundTaskEntry {
  taskId: string
  toolName: string
  done: Promise<BackgroundTaskOutcome>
  /** Per-task timeout in ms. When elapsed, the task is marked as timed out. */
  timeoutMs: number
}

interface InternalEntry extends BackgroundTaskEntry {
  registeredAt: number
  settled: boolean
  outcome: BackgroundTaskOutcome | null
}

export class BackgroundTaskRegistry {
  private readonly entries: InternalEntry[] = []

  register(entry: BackgroundTaskEntry): void {
    const internal: InternalEntry = {
      taskId: entry.taskId,
      toolName: entry.toolName,
      done: entry.done,
      timeoutMs: entry.timeoutMs,
      registeredAt: Date.now(),
      settled: false,
      outcome: null,
    }
    internal.done.then(
      (outcome: BackgroundTaskOutcome) => {
        internal.settled = true
        internal.outcome = outcome
      },
      (err: unknown) => {
        internal.settled = true
        internal.outcome = {
          status: 'failed',
          taskId: internal.taskId,
          toolName: internal.toolName,
          error: err instanceof Error ? err.message : String(err),
        }
      },
    )
    this.entries.push(internal)
  }

  hasPending(): boolean {
    return this.entries.some((e: InternalEntry) => !e.settled)
  }

  /** Non-blocking: return all outcomes that have already settled and remove them from the registry. */
  drain(): BackgroundTaskOutcome[] {
    const settled: BackgroundTaskOutcome[] = []
    for (let i: number = this.entries.length - 1; i >= 0; i--) {
      const entry: InternalEntry | undefined = this.entries[i]
      if (entry && entry.settled && entry.outcome) {
        settled.push(entry.outcome)
        this.entries.splice(i, 1)
      }
    }
    return settled
  }

  /** Block until at least one task settles or all remaining tasks exceed their
   *  per-task timeout. Returns all outcomes that settled by the time the race
   *  resolves (may be >1 when tasks settle in the same tick). Returns empty
   *  array when nothing left to await (all expired or empty). */
  async awaitNext(): Promise<BackgroundTaskOutcome[]> {
    this.expireOverdue()
    const pending: InternalEntry[] = this.entries.filter((e: InternalEntry) => !e.settled)
    if (pending.length === 0) return this.drain()

    // If any entries already settled, return them immediately without blocking
    const alreadySettled: BackgroundTaskOutcome[] = this.drain()
    if (alreadySettled.length > 0) return alreadySettled

    const earliestDeadline: number = Math.min(
      ...pending.map((e: InternalEntry) => e.registeredAt + e.timeoutMs),
    )
    const waitMs: number = Math.max(0, earliestDeadline - Date.now())

    const timeoutPromise: Promise<null> = new Promise<null>((resolve: (v: null) => void) => {
      setTimeout(() => resolve(null), waitMs)
    })

    // Race on internally-normalized promises (never reject — register() catches
    // rejections and marks settled/outcome), so an unhandled rejection cannot
    // abort the loop.
    const settled: Promise<BackgroundTaskOutcome | null>[] = pending.map(
      (e: InternalEntry) => e.done.then(
        (o: BackgroundTaskOutcome) => o,
        () => null,
      ),
    )

    await Promise.race([...settled, timeoutPromise])

    // Timer or natural settlement — expire overdue, then drain everything settled
    this.expireOverdue()
    return this.drain()
  }

  /** Block until all tasks settle or individually time out. */
  async awaitAll(): Promise<BackgroundTaskOutcome[]> {
    const results: BackgroundTaskOutcome[] = []

    while (this.hasPending()) {
      const outcomes: BackgroundTaskOutcome[] = await this.awaitNext()
      if (outcomes.length === 0) break
      results.push(...outcomes)
    }

    // Catch-up: drain anything that settled between the last awaitNext and here
    results.push(...this.drain())
    return results
  }

  /** Mark entries whose per-task timeout has elapsed. */
  private expireOverdue(): void {
    const now: number = Date.now()
    for (const entry of this.entries) {
      if (!entry.settled && (now - entry.registeredAt) >= entry.timeoutMs) {
        entry.settled = true
        entry.outcome = {
          status: 'timeout',
          taskId: entry.taskId,
          toolName: entry.toolName,
          error: `Background task timed out after ${entry.timeoutMs}ms`,
        }
      }
    }
  }

  /** Total number of tasks currently tracked (settled + pending). */
  get size(): number {
    return this.entries.length
  }
}
