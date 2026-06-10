import { createTool, type Tool, type AgentContext } from '@airo/ai-lib'
import { z } from 'zod'

import { SubAgentRunner, type SubAgentEvent } from '../../agents/sub-agent-runner.js'
import { getSubAgentConfig, type SubAgentName as BackgroundAgentName } from '../../agents/sub-agents/index.js'
import { interactiveSubAgentManager } from '../../agents/interactive-sub-agent-manager.js'
import { createInteractiveInterviewConfig } from '../../agents/sub-agents/interview.js'
import { maybeEmitDebugTurnStats } from '../../server/debug-stats-emit.js'
import { computeDebugTurnStats } from '../../utils/debug-turn-stats.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'run-agent-tool' })

const VALID_AGENTS = ['discovery', 'planning', 'plan-review', 'media', 'design', 'builder', 'interview', 'verification'] as const
type AgentName = typeof VALID_AGENTS[number]

export const runAgentAITool: Tool = createTool(
  `Dispatch a task to a specialized sub-agent. Each sub-agent runs in its own context with its own tools.

Modes:
- "background" (default): Sub-agent runs internally and returns a summary. Cannot ask the user questions. Multiple background calls in the same turn execute in parallel.
- "interactive": Sub-agent takes over the conversation temporarily. It CAN ask the user questions via askQuestion. Only one interactive agent at a time. Use for tasks requiring user input (e.g. interview).

Available agents: discovery (research/scraping), planning (write implementation plans), plan-review (review and fix plans against quality criteria), media (find/generate images), design (create/update design.md + CSS), builder (execute plans, write code), interview (structured Q&A with user to produce docs/brief.md), verification (run automated checks against built app).`,
  z.object({
    agent: z.enum(VALID_AGENTS).describe('Which sub-agent to dispatch to'),
    title: z.string().describe('Short display title for the task (shown to user in the UI card)'),
    task: z.string().describe('Natural language task description for the sub-agent'),
    inputs: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}).describe('Structured context: file paths, URLs, search queries, etc.'),
    mode: z.enum(['background', 'interactive']).default('background').describe('"background" runs internally (no user interaction). "interactive" lets the sub-agent ask questions.'),
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

    const subAgentConfig = await getSubAgentConfig(agent as BackgroundAgentName, appPath)
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
            conversationId: (context?.metadata?.conversationId as string) ?? 'unknown',
            agentName: `sub:${event.agent}`,
            modelName: usage.modelName,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cachedInputTokens: usage.cachedInputTokens,
            cacheWriteInputTokens: usage.cacheWriteInputTokens,
            steps: usage.steps,
          }
          // WS path: emit via Socket.IO directly
          maybeEmitDebugTurnStats(statsInput)
          // SSE path: emit via eventEmitter → event channel
          if (emitter) {
            const payload = computeDebugTurnStats(statsInput)
            emitter.emit('debug_turn_stats', payload)
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    const result = await runner.execute(task, inputs, emitEvent, context as unknown as Record<string, unknown> | undefined)

    if (result.status === 'error') {
      logger.error('runAgent.failed', {
        agent,
        appId,
        summary: result.summary?.slice(0, 200),
      })
      throw new Error(`Sub-agent "${agent}" failed: ${result.summary}`)
    }

    logger.info('runAgent.completed', {
      agent,
      appId,
      artifactCount: result.artifacts.length,
    })

    return result
  }
)

const INTERACTIVE_AGENT_FACTORIES: Partial<Record<AgentName, (agentId: string) => Promise<unknown>>> = {
  interview: createInteractiveInterviewConfig,
}

async function handleInteractiveMode(
  agent: AgentName,
  task: string,
  _inputs: Record<string, string | string[]>,
  context: AgentContext | undefined
): Promise<{ ok: boolean; interactive: true; agent: string; error?: string }> {
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
