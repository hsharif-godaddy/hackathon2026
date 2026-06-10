import type { Tool } from '@airo/ai-lib'
import { AgentWrapper, getModel } from '@airo/ai-lib'
import { Logger } from '../logging/index.js'
import { skillToolManager } from '../tools/skill-tool-manager.js'

const logger = Logger.create({ component: 'sub-agent-runner' })

export interface VisualOutput {
  type: 'media' | 'page' | 'doc'
  label: string
  url?: string
  thumbnailUrl?: string
}

export type VisualOutputExtractor = (
  toolName: string,
  args: unknown,
  result: unknown
) => VisualOutput | null

export interface SubAgentConfig {
  id: string
  name: string
  system: string
  tools: Record<string, Tool>
  model: string
  maxSteps: number
  temperature?: number
  maxOutputTokens?: number
  visualOutputExtractors?: VisualOutputExtractor[]
  enablePromptCaching?: boolean
}

export interface SubAgentEvent {
  event: 'started' | 'tool_call' | 'progress' | 'completed' | 'error' | 'usage'
  agent: string
  detail: string
}

export interface SubAgentResult {
  summary: string
  artifacts: string[]
  status: 'success' | 'error'
  docPath?: string
  visualOutputs?: VisualOutput[]
}

const ARTIFACT_TOOL_NAMES = new Set(['writeFile', 'str_replace_based_edit_tool', 'fileEdit'])

function extractArtifacts(toolResults: Array<{ toolName: string; result: unknown }>): string[] {
  const paths = new Set<string>()
  for (const { toolName, result } of toolResults) {
    if (ARTIFACT_TOOL_NAMES.has(toolName) && result && typeof result === 'object') {
      const path = (result as Record<string, unknown>).path
      if (typeof path === 'string') {
        paths.add(path)
      }
    }
  }
  return [...paths]
}

const TOOL_DETAIL_MAP: Record<string, { field: string; prefix: string; maxLen?: number }> = {
  str_replace_based_edit_tool: { field: 'path', prefix: 'Editing' },
  readFile: { field: 'path', prefix: 'Reading' },
  directoryListing: { field: 'path', prefix: 'Listing' },
  terminalCommand: { field: 'command', prefix: 'Running:', maxLen: 60 },
  showDoc: { field: 'path', prefix: 'Document ready:' },
  websiteScraper: { field: 'url', prefix: 'Scraping', maxLen: 60 },
}

function formatToolDetail(toolName: string, args: unknown, result: unknown): string {
  if (toolName === 'media' && result) {
    const r: Record<string, unknown> = typeof result === 'string'
      ? (() => { try { return JSON.parse(result) } catch { return {} } })()
      : result as Record<string, unknown>
    if (r.slot) return `Media: set ${r.slot as string}`
    if (r.error) return `Media: ${r.error as string}`
  }

  const mapping = TOOL_DETAIL_MAP[toolName]
  if (mapping && args && typeof args === 'object') {
    const value = (args as Record<string, unknown>)[mapping.field]
    if (typeof value === 'string') {
      const truncated = mapping.maxLen ? value.slice(0, mapping.maxLen) : value
      return `${mapping.prefix} ${truncated}`
    }
  }

  return `Using ${toolName}...`
}

function buildUserMessage(task: string, inputs: Record<string, string | string[]>): string {
  const parts: string[] = [task]
  for (const [key, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      parts.push(`${key}: ${value.join(', ')}`)
    } else {
      parts.push(`${key}: ${value}`)
    }
  }
  return parts.join('\n\n')
}

export class SubAgentRunner {
  private readonly config: SubAgentConfig

  constructor(config: SubAgentConfig) {
    this.config = config
  }

  async execute(
    task: string,
    inputs: Record<string, string | string[]>,
    onEvent: (event: SubAgentEvent) => void,
    executionContext?: Record<string, unknown>
  ): Promise<SubAgentResult> {
    const { id, name, system, tools, model, maxSteps, temperature, maxOutputTokens, visualOutputExtractors, enablePromptCaching } = this.config

    onEvent({ event: 'started', agent: name, detail: 'Starting task execution' })

    try {
      const languageModel = await getModel(model)

      let docPath: string | undefined
      const visualOutputs: VisualOutput[] = []
      const agent = new AgentWrapper({
        id,
        name,
        system,
        model: languageModel,
        modelName: model,
        tools,
        maxSteps,
        temperature: temperature ?? 0.3,
        maxOutputTokens: maxOutputTokens ?? 16000,
        enablePromptCaching: enablePromptCaching ?? false,
        logger,
        afterToolExecution: (toolName: string, args: unknown, result: unknown) => {
          const detail = formatToolDetail(toolName, args, result)
          onEvent({ event: 'tool_call', agent: id, detail })
          if (toolName === 'showDoc' && args && typeof args === 'object' && 'path' in args) {
            const a = args as Record<string, unknown>
            if (a.type === 'doc' || (!a.type && a.path)) {
              docPath = a.path as string
            }
          }
          if (visualOutputExtractors) {
            for (const extractor of visualOutputExtractors) {
              const output = extractor(toolName, args, result)
              if (output) visualOutputs.push(output)
            }
          }
          return undefined
        },
      }, skillToolManager)

      const userMessage = buildUserMessage(task, inputs)
      const streamResult = await agent.streamGenerate(userMessage, { executionContext })

      let fullText = ''
      let lastProgressEmit = Date.now()
      for await (const chunk of streamResult.textStream) {
        fullText += chunk
        const now = Date.now()
        if (now - lastProgressEmit > 3000) {
          const lines = fullText.split('\n').length
          onEvent({ event: 'progress', agent: id, detail: `Writing... (${lines} lines)` })
          lastProgressEmit = now
        }
      }

      const finalResult = await streamResult.getFinalResult()

      const fullResult = finalResult as {
        usage: unknown
        totalUsage?: {
          inputTokens?: number
          outputTokens?: number
          totalTokens?: number
          cachedInputTokens?: number
          inputTokenDetails?: { cacheWriteTokens?: number }
        }
        steps?: unknown[]
        finishReason: unknown
        toolCalls: unknown
      }
      if (fullResult.totalUsage && fullResult.totalUsage.inputTokens !== undefined) {
        const totalUsage = fullResult.totalUsage
        onEvent({
          event: 'usage',
          agent: id,
          detail: JSON.stringify({
            modelName: model,
            inputTokens: totalUsage.inputTokens ?? 0,
            outputTokens: totalUsage.outputTokens ?? 0,
            totalTokens: totalUsage.totalTokens ?? 0,
            cachedInputTokens: totalUsage.cachedInputTokens ?? 0,
            cacheWriteInputTokens: totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
            steps: Array.isArray(fullResult.steps) ? fullResult.steps.length : 0,
          }),
        })
      }

      const toolResults: Array<{ toolName: string; result: unknown }> = []
      if (finalResult.toolCalls && Array.isArray(finalResult.toolCalls)) {
        for (const call of finalResult.toolCalls) {
          if (call && typeof call === 'object' && 'toolName' in call) {
            toolResults.push({
              toolName: call.toolName as string,
              result: 'result' in call ? call.result : ('output' in call ? call.output : undefined),
            })
          }
        }
      }

      const artifacts = extractArtifacts(toolResults)

      onEvent({ event: 'completed', agent: name, detail: fullText })

      return {
        summary: fullText,
        artifacts,
        status: 'success',
        ...(docPath && { docPath }),
        ...(visualOutputs.length > 0 && { visualOutputs }),
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('subAgentRunner.execute.error', { agent: name, error: message })

      onEvent({ event: 'error', agent: name, detail: message })

      return {
        summary: message,
        artifacts: [],
        status: 'error',
      }
    }
  }
}
