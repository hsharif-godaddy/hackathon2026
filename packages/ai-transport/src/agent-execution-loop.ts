/** Callbacks driving `executeAgentLoop`.
 *
 * **Error contract:** the loop awaits async callbacks and does NOT catch
 * rejections — a throw from `streamAgentTurn`, `postStreamValidate`, or
 * `onHandoff` propagates out of `executeAgentLoop` and aborts the loop.
 * Synchronous callbacks (`getAgent`, `getAutoContinuation`,
 * `getHandoffDetails`, `isAborted`) must not throw; implementors that do
 * additional work (DB reads, metric emission) must guard internally.
 * Transports that want additive, non-fatal hooks (e.g. WS
 * `postStreamValidator`) wrap the hook in their own try/catch. */
export interface AgentExecutionLoopCallbacks<TAgent = unknown> {
  getAgent: (name: string) => TAgent | undefined
  streamAgentTurn: (agent: TAgent, agentName: string, message: string, iteration: number) => Promise<void>
  /** Runs after each stream iteration, before auto-continuation/handoff checks.
   * The callback is expected to mutate `context.metadata` (setting `__autoContinue`
   * and `__continuationPrompt`) which getAutoContinuation will then pick up.
   * Called unconditionally by the loop — implementations that support
   * tool-driven `__autoContinue` should return early when that flag is
   * already set, to avoid clobbering a continuation the model already chose. */
  postStreamValidate?: (agentName: string) => Promise<void>
  getAutoContinuation: () => { prompt: string } | null
  getHandoffDetails: (currentAgent: string) => { newAgentName: string; handoffPrompt: string } | null
  onHandoff: (oldAgent: string, newAgent: string) => Promise<void>
  isAborted: () => boolean
}

export type AgentExecutionTermination = 'completed' | 'aborted' | 'max_handoffs'

export interface AgentExecutionLoopResult {
  finalAgentName: string
  /** Number of `streamAgentTurn` calls the loop made. 0 when aborted before
   * the first turn; `MAX_HANDOFFS` when the cap is hit. Not the same as the
   * 0-indexed `iteration` parameter passed to `streamAgentTurn`. */
  iterations: number
  termination: AgentExecutionTermination
}

/** Thrown when an agent name referenced for a handoff (or as the initial agent)
 * cannot be resolved. The wire-visible message is intentionally generic; the
 * real agent name is preserved on `agentName` for server-side logging. */
export class AgentNotFoundError extends Error {
  override readonly name = 'AgentNotFoundError'
  readonly agentName: string
  constructor(agentName: string) {
    super('Agent unavailable')
    this.agentName = agentName
  }
}

/** Maximum number of iterations (initial turn + handoffs + auto-continuations)
 * the loop will run before forcing `termination: 'max_handoffs'`. Exported so
 * callers can compare `result.iterations === MAX_HANDOFFS` without magic
 * numbers. */
export const MAX_HANDOFFS = 10

export async function executeAgentLoop<TAgent = unknown>(
  initialAgent: string,
  initialMessage: string,
  callbacks: AgentExecutionLoopCallbacks<TAgent>,
): Promise<AgentExecutionLoopResult> {
  let agentName = initialAgent
  let currentMessage = initialMessage

  for (let iteration = 0; iteration < MAX_HANDOFFS; iteration++) {
    if (callbacks.isAborted()) {
      return { finalAgentName: agentName, iterations: iteration, termination: 'aborted' }
    }

    const agent = callbacks.getAgent(agentName)
    if (!agent) {
      throw new AgentNotFoundError(agentName)
    }

    await callbacks.streamAgentTurn(agent, agentName, currentMessage, iteration)

    if (callbacks.isAborted()) {
      return { finalAgentName: agentName, iterations: iteration + 1, termination: 'aborted' }
    }

    if (callbacks.postStreamValidate) {
      await callbacks.postStreamValidate(agentName)
      if (callbacks.isAborted()) {
        return { finalAgentName: agentName, iterations: iteration + 1, termination: 'aborted' }
      }
    }

    const autoContinue = callbacks.getAutoContinuation()
    if (autoContinue) {
      currentMessage = autoContinue.prompt
      continue
    }

    const handoff = callbacks.getHandoffDetails(agentName)
    if (!handoff) {
      return { finalAgentName: agentName, iterations: iteration + 1, termination: 'completed' }
    }

    await callbacks.onHandoff(agentName, handoff.newAgentName)
    agentName = handoff.newAgentName
    currentMessage = handoff.handoffPrompt
  }

  return { finalAgentName: agentName, iterations: MAX_HANDOFFS, termination: 'max_handoffs' }
}
