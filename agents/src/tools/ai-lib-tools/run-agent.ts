import { createTool, type Tool, type AgentContext } from '@airo/ai-lib'
import { z } from 'zod'

import { SubAgentRunner, buildContinuationMessage, type SubAgentEvent } from '../../agents/sub-agent-runner.js'
import { getSubAgentConfig, type SubAgentName as BackgroundAgentName } from '../../agents/sub-agents/index.js'
import { interactiveSubAgentManager } from '../../agents/interactive-sub-agent-manager.js'
import { createInteractiveInterviewConfig } from '../../agents/sub-agents/interview.js'
import { createInteractiveBuilderConfig } from '../../agents/sub-agents/builder.js'
import { computeDebugTurnStats } from '../../utils/debug-turn-stats.js'
import { Logger } from '../../logging/index.js'
import { subAgentJobRegistry } from '../../agents/sub-agent-job-registry.js'
import { detectStaleFiles } from '../../agents/sub-agent-transcript.js'

const logger = Logger.create({ component: 'run-agent-tool' })

const VALID_AGENTS = ['planning', 'plan-review', 'media', 'design', 'builder', 'design-kit-build', 'task-worker', 'brand-showcase', 'interview', 'workflow-init', 'developer-typecheck'] as const
type AgentName = typeof VALID_AGENTS[number]

export const runAgentAITool: Tool = createTool(
  `Dispatch a task to a specialized sub-agent. Each sub-agent runs in its own context with its own tools.

Modes:
- "background" (default): Sub-agent is dispatched NON-BLOCKING. Returns { jobId, status: "running" } immediately. You MUST call awaitAgents([jobId]) to get results before using them. Multiple background calls can be dispatched in the same turn for true parallelism, then awaited together.
- "interactive": Sub-agent takes over the conversation temporarily. It CAN ask the user questions via askQuestion. Only one interactive agent at a time. Use for tasks requiring user input (e.g. interview).

Available agents: planning (write implementation plans), plan-review (review and fix plans against quality criteria), media (find/generate images), design (create/update design.md + CSS), builder (execute plans, write code), design-kit-build (build one slice of a website — the site chrome or the homepage — faithfully from an installed design kit; self-loads docs/ui-kit/ + anchor.json), task-worker (generic worker with no built-in prompt — executes a single self-contained task exactly as written in the task string, e.g. searching media into slots or running a skill; media/skill tools only, cannot write source files), brand-showcase (write the standalone public/brand-showcase.html brand-specimen page from inlined brand content; file-only, never generates media), interview (structured Q&A with user to produce docs/brief.md), workflow-init (produce a step DAG for workflow initialization — returns JSON with archetype, northStar, steps).`,
  z.object({
    agent: z.enum(VALID_AGENTS).describe('Which sub-agent to dispatch to'),
    title: z.string().describe('Short display title for the task (shown to user in the UI card)'),
    task: z.string().describe('Natural language task description for the sub-agent'),
    inputs: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}).describe('Structured context: file paths, URLs, search queries, etc.'),
    mode: z.enum(['background', 'interactive']).default('background').describe('"background" runs internally (no user interaction). "interactive" lets the sub-agent ask questions.'),
    continue: z.boolean().default(false).describe('Re-enter a prior sub-agent run, replaying its context instead of starting cold. Use for follow-up edits.'),
    fromJobId: z.string().optional().describe('The jobId of the prior run to continue. If omitted and exactly one completed job of this agent type exists, that one is used.'),
  }),
  async (input, context) => {
    const { agent, task, inputs, mode } = input
    const appId = context?.metadata?.appId as string | undefined
    const appPath = context?.metadata?.appPath as string | undefined
    const toolId = context?.metadata?.toolId as string | undefined

    if (!appPath) {
      throw new Error('runAgent requires appPath in context metadata')
    }

    if (mode === 'interactive') {
      return handleInteractiveMode(agent as AgentName, task, inputs, context as AgentContext | undefined)
    }

    if (agent === 'interview') {
      throw new Error('The interview agent only supports interactive mode')
    }

    logger.info('runAgent.dispatching', { agent, appId, task: task.slice(0, 100) })

    // conversationId is the registry key and a load-bearing invariant (it lets
    // detached-job completion/abort callbacks find the right registry). Fail loud
    // rather than fall back to a shared 'unknown' bucket, which would let jobs,
    // sessions, and aborts cross-contaminate between conversations.
    const conversationId = context?.metadata?.conversationId as string | undefined
    if (!conversationId) {
      throw new Error('runAgent requires conversationId in context metadata')
    }
    const registry = subAgentJobRegistry.get(conversationId)

    const subAgentConfig = await getSubAgentConfig(agent as BackgroundAgentName)
    const runner = new SubAgentRunner(subAgentConfig)

    const emitEvent = (event: SubAgentEvent): void => {
      const emitter = context?.metadata?.eventEmitter as
        | { emit: (type: string, data: unknown) => void }
        | undefined
      if (emitter) {
        emitter.emit('subagent_event', {
          subagentToolId: toolId,
          agent: event.agent,
          event: event.event,
          detail: event.detail,
        })
      }
      if (event.event === 'usage' && appId) {
        try {
          const usage = JSON.parse(event.detail) as {
            modelName: string
            inputTokens: number
            outputTokens: number
            totalTokens: number
            cachedInputTokens: number
            cacheWriteInputTokens: number
            steps: number
          }
          const statsInput = {
            appId,
            conversationId,
            agentName: `sub:${event.agent}`,
            modelName: usage.modelName,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cachedInputTokens: usage.cachedInputTokens,
            cacheWriteInputTokens: usage.cacheWriteInputTokens,
            steps: usage.steps,
          }
          // Emit via eventEmitter → SSE event channel
          if (emitter) {
            const payload = computeDebugTurnStats(statsInput)
            emitter.emit('debug_turn_stats', payload)
          }
        } catch (err) {
          // Malformed usage payload — drop the stats but surface it, so a recurring bad
          // payload is visible rather than silently losing cost-attribution data.
          logger.warn('runAgent.usage.parse_failed', {
            agent: event.agent,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    const wantContinue = input.continue
    const fromJobId = input.fromJobId

    // Ambiguous re-entry: continue with no explicit fromJobId, but more than one
    // completed run of this agent type is cached. Don't silently guess (or cold-run)
    // — make the model choose. Resolved before dispatch so the model gets the error
    // synchronously instead of via awaitAgents.
    if (wantContinue && !fromJobId) {
      const candidates = registry.sessionJobIdsByAgent(agent)
      if (candidates.length > 1) {
        logger.info('runAgent.reentry.ambiguous', { agent, appId, candidates })
        return {
          agent,
          title: input.title,
          status: 'error',
          error: `Ambiguous re-entry: ${candidates.length} completed "${agent}" runs are cached (${candidates.join(', ')}). Pass fromJobId to choose which run to continue.`,
        }
      }
    }

    const jobId = registry.dispatch({ agent, title: input.title }, async (signal) => {
      const session = wantContinue
        ? (fromJobId ? registry.getSession(fromJobId) : registry.findLatestSessionByAgent(agent)?.session)
        : undefined

      let result
      if (session) {
        const stale = await detectStaleFiles([...session.filesRead, ...session.filesWritten], appPath)
        const contextualTask = buildContinuationMessage(task, stale)
        result = await runner.continueExecution(
          session.messages,
          contextualTask,
          inputs,
          emitEvent,
          context as unknown as Record<string, unknown> | undefined,
          signal
        )
      } else {
        result = await runner.execute(
          task,
          inputs,
          emitEvent,
          context as unknown as Record<string, unknown> | undefined,
          signal
        )
      }

      // A deliberate cancellation (user stop / recovery-timeout) surfaces as a
      // signalled abort with the runner returning { status: 'error' }. Report it
      // as 'aborted' — not a failure — so logs and the UI card don't treat every
      // Stop as an error.
      const aborted = signal.aborted
      if (aborted) {
        logger.info('runAgent.aborted', { agent, appId })
      } else if (result.status === 'error') {
        logger.error('runAgent.failed', { agent, appId, summary: result.summary?.slice(0, 200) })
      } else {
        logger.info('runAgent.completed', { agent, appId, artifactCount: result.artifacts.length, reentry: !!session })
      }

      // Detached dispatch returns only { jobId } to the model, so the sub-agent's
      // final outputs no longer ride back on the tool result. Emit them as a final
      // structured event (JSON detail, like the `usage` event) so the UI's runAgent
      // card can flip from running → done and render summary/artifacts/visualOutputs
      // the moment the job finishes — independent of when awaitAgents is called.
      emitEvent({
        event: 'outputs',
        agent,
        detail: JSON.stringify({
          status: aborted ? 'aborted' : result.status,
          summary: result.summary,
          artifacts: result.artifacts,
          visualOutputs: result.visualOutputs ?? [],
          ...(result.docPath ? { docPath: result.docPath } : {}),
        }),
      })

      return result
    })

    const status = registry.snapshot().find(j => j.jobId === jobId)?.status ?? 'running'
    return { jobId, agent, title: input.title, status }
  }
)

const INTERACTIVE_AGENT_FACTORIES: Partial<Record<AgentName, (agentId: string) => Promise<unknown>>> = {
  interview: createInteractiveInterviewConfig,
  builder: createInteractiveBuilderConfig,
}

async function handleInteractiveMode(
  agent: AgentName,
  task: string,
  _inputs: Record<string, string | string[]>,
  context: AgentContext | undefined
): Promise<{ ok: boolean; interactive: boolean; agent: string; error?: string }> {
  const metadata = context?.metadata
  const sessionId: string | undefined =
    metadata?.sessionId as string | undefined ??
    context?.sessionId ??
    (context as unknown as Record<string, unknown> | undefined)?.socketId as string | undefined

  if (!sessionId) {
    throw new Error('Interactive mode requires a session context (sessionId)')
  }

  if (interactiveSubAgentManager.hasActiveSession(sessionId)) {
    throw new Error('An interactive sub-agent is already running on this connection')
  }

  const configFactory = INTERACTIVE_AGENT_FACTORIES[agent]
  if (!configFactory) {
    throw new Error(`Agent "${agent}" does not support interactive mode`)
  }

  const childAgentName: string = `interactive-${agent}`
  const parentAgentName: string = (metadata?.agentId as string | undefined) ?? 'deep-build'

  logger.info('runAgent.interactive.launching', {
    agent,
    appId: metadata?.appId,
    sessionId,
    childAgentName,
  })

  const agentConfig = await configFactory(childAgentName)
  interactiveSubAgentManager.getDeps().registerAgent(childAgentName, agentConfig)

  interactiveSubAgentManager.launch(
    sessionId,
    parentAgentName,
    childAgentName,
    task,
  )

  try {
    await interactiveSubAgentManager.triggerHandoffToChild(sessionId, task)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('runAgent.interactive.handoff_failed', { agent, sessionId, error: message })
    interactiveSubAgentManager.cleanup(sessionId)
    interactiveSubAgentManager.getDeps().removeAgent(childAgentName)
    return { ok: false, interactive: false, agent: childAgentName, error: `Handoff failed: ${message}` }
  }

  return { ok: true, interactive: true, agent: childAgentName }
}

export const awaitAgentsAITool: Tool = createTool(
  `Wait for one or more previously dispatched sub-agent jobs to finish, then return their results.

Pass the jobIds returned by earlier runAgent calls. Blocks until all listed jobs complete. Returns each job's status ("success" | "error" | "aborted"), summary, artifacts, and (on failure) error. A failed job is reported as a structured error result — it does NOT throw — so you can decide whether to retry or route around it.`,
  z.object({
    jobIds: z.array(z.string()).min(1).describe('Job IDs returned by prior runAgent dispatches'),
  }),
  async (input, context) => {
    // Must resolve the SAME registry the jobs were dispatched into — see the
    // conversationId invariant note in runAgent. Fail loud rather than join a
    // shared 'unknown' bucket and return spurious "No job" errors.
    const conversationId = context?.metadata?.conversationId as string | undefined
    if (!conversationId) {
      throw new Error('awaitAgents requires conversationId in context metadata')
    }
    const registry = subAgentJobRegistry.get(conversationId)
    const results = await registry.await(input.jobIds)
    return { results }
  }
)
