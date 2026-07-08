import type { ModelMessage } from 'ai'
import { z } from 'zod'
import type { Tool } from '@airo/ai-lib'
import { AgentWrapper, createTool, getModel } from '@airo/ai-lib'
import { Logger } from '../logging/index.js'
import { skillToolManager } from '../tools/skill-tool-manager.js'
import type { FileAccess } from './sub-agent-transcript.js'
import { extractTranscript, extractFileAccess, truncateTranscript, WRITE_TOOL_NAMES } from './sub-agent-transcript.js'
import type { SubAgentUsage } from './result-envelope.js'

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
  providerOptions?: Record<string, unknown>
}

export interface SubAgentEvent {
  event: 'started' | 'tool_call' | 'progress' | 'completed' | 'error' | 'usage' | 'outputs'
  agent: string
  detail: string
}

/**
 * How a delegated run should return its result.
 *
 * - `'summary'` (default): the run returns only its prose `summary` — current
 *   behavior, no extra tool, no forced completion.
 * - `{ schema }`: the worker is given a synthetic terminal tool (`returnResult`)
 *   whose input schema IS `schema`, and is told to finish by calling it with its
 *   result. `stopAfterTools` ends the run on a successful call; the AI SDK
 *   validates the tool input against `schema` natively and lets the model retry a
 *   malformed call within the step budget. The validated payload rides back on
 *   `SubAgentResult.structuredOutput`. If the worker never returns a valid result
 *   (exhausts its steps without a good `returnResult` call), the run resolves as
 *   `status: 'error'` (a distinct outcome, never a silent success) — mirroring the
 *   Claude Agent SDK's `error_max_structured_output_retries`.
 *
 * This is the forced-terminal-tool idiom (how the Claude Agent SDK's own
 * structured output works). The schema is a code-level API (like the SDK's
 * `agent(prompt, { schema })`), not something the orchestrating model hand-authors.
 */
export type ReturnFormat = 'summary' | { schema: z.ZodType }

export interface SubAgentResult {
  summary: string
  artifacts: string[]
  status: 'success' | 'error'
  docPath?: string
  visualOutputs?: VisualOutput[]
  /** Token/step usage for the run, when the model reported it. Rides the result envelope. */
  usage?: SubAgentUsage
  /**
   * The schema-validated payload, present only when the caller passed a
   * `{ schema }` `ReturnFormat` and validation succeeded. Generic (`unknown`) —
   * the task-specific shape lives in the caller's schema, not here.
   */
  structuredOutput?: unknown
  /** Internal: captured transcript for re-entry. Stripped before returning to the model. */
  _session?: { messages: ModelMessage[]; filesRead: FileAccess[]; filesWritten: FileAccess[] }
  /** Internal: agent id for the captured session. */
  _sessionAgent?: string
}

function extractArtifacts(toolResults: Array<{ toolName: string; result: unknown }>): string[] {
  const paths = new Set<string>()
  for (const { toolName, result } of toolResults) {
    if (WRITE_TOOL_NAMES.has(toolName) && result && typeof result === 'object') {
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

interface StepForSession {
  response: { messages: ModelMessage[] }
  toolResults?: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>
}

/**
 * Build the re-entry session transcript from a run's steps.
 * Fresh run: pass no priorMessages → the original task is prepended.
 * Continuation: pass priorMessages → prepended, then the continuation's user
 * turn, then the new response messages. The AI SDK's `response.messages` carries
 * only assistant/tool roles (the prompt is passed separately to streamGenerate),
 * so we must re-insert the user turn ourselves — mirroring extractTranscript —
 * or replays of consecutive assistant blocks lose the instruction that drove them.
 */
export function buildSessionTranscript(
  steps: StepForSession[],
  userMessage: string,
  priorMessages?: ModelMessage[]
): { messages: ModelMessage[]; filesRead: FileAccess[]; filesWritten: FileAccess[] } {
  const responseMsgs = steps[steps.length - 1]?.response?.messages ?? []
  const userTurn = { role: 'user', content: [{ type: 'text', text: userMessage }] } as ModelMessage
  const full = priorMessages
    ? [...priorMessages, userTurn, ...responseMsgs]
    : extractTranscript(steps, userMessage)
  return {
    messages: truncateTranscript(full),
    filesRead: extractFileAccess(steps, 'read'),
    filesWritten: extractFileAccess(steps, 'write'),
  }
}

export function buildContinuationMessage(task: string, staleFiles: string[]): string {
  if (staleFiles.length === 0) return task
  const list = staleFiles.map(f => `- ${f}`).join('\n')
  return `Note: these files have changed since you last read or wrote them — re-read them before relying on your prior knowledge:\n${list}\n\n${task}`
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
    executionContext?: Record<string, unknown>,
    signal?: AbortSignal,
    options?: { returnFormat?: ReturnFormat }
  ): Promise<SubAgentResult> {
    return this.run(task, inputs, onEvent, executionContext, signal, undefined, options)
  }

  async continueExecution(
    priorMessages: ModelMessage[],
    task: string,
    inputs: Record<string, string | string[]>,
    onEvent: (event: SubAgentEvent) => void,
    executionContext?: Record<string, unknown>,
    signal?: AbortSignal,
    options?: { returnFormat?: ReturnFormat }
  ): Promise<SubAgentResult> {
    return this.run(task, inputs, onEvent, executionContext, signal, priorMessages, options)
  }

  private async run(
    task: string,
    inputs: Record<string, string | string[]>,
    onEvent: (event: SubAgentEvent) => void,
    executionContext?: Record<string, unknown>,
    signal?: AbortSignal,
    priorMessages?: ModelMessage[],
    options?: { returnFormat?: ReturnFormat }
  ): Promise<SubAgentResult> {
    const { id, name, system, tools, model, maxSteps, temperature, maxOutputTokens, visualOutputExtractors, enablePromptCaching, providerOptions } = this.config

    onEvent({ event: 'started', agent: name, detail: priorMessages ? 'Resuming prior context' : 'Starting task execution' })

    // Structured returns: when the caller requests a schema, give the worker a
    // synthetic terminal tool whose input schema IS that schema and tell it to
    // finish by calling it. `stopAfterTools` ends the run on a successful call and
    // the AI SDK validates the tool input natively (retrying a malformed call).
    // Nothing here fires for the default `'summary'` path — the toolset, system
    // prompt, and stop conditions are byte-identical to before.
    //
    // Mechanism note (swap point): this "forced terminal tool" is one of two
    // interchangeable implementations behind the same ReturnFormat API +
    // `structuredOutput` envelope field — changing it touches only this block and the
    // validation below, never a caller. Chosen over parse-the-final-text (a second
    // turn that emits+parses JSON) because it adds no extra turn per worker and reuses
    // the SDK's native tool-input validation. It is *encouraged*, not hard-forced:
    // `toolChoice: 'required'` isn't plumbed through ai-lib, so a worker can still end
    // without calling `returnResult` (handled as a structured error below). If workers
    // often fail to call it in practice, add bounded last-step forcing via ai-lib's
    // prepareStep (force returnResult only when stepNumber === maxSteps - 1), not a
    // global required tool-choice.
    const returnFormat: ReturnFormat = options?.returnFormat ?? 'summary'
    const wantsStructured: boolean = returnFormat !== 'summary'
    const effectiveTools: Record<string, Tool> = returnFormat !== 'summary'
      ? { ...tools, [RETURN_RESULT_TOOL]: buildReturnResultTool(returnFormat.schema) }
      : tools
    const effectiveSystem: string = wantsStructured ? `${system}\n\n${RETURN_RESULT_INSTRUCTION}` : system

    try {
      const languageModel = await getModel(model)

      let docPath: string | undefined
      const visualOutputs: VisualOutput[] = []
      const agent = new AgentWrapper({
        id,
        name,
        system: effectiveSystem,
        model: languageModel,
        modelName: model,
        tools: effectiveTools,
        maxSteps,
        temperature: temperature ?? 0.3,
        maxOutputTokens: maxOutputTokens ?? 16000,
        enablePromptCaching: enablePromptCaching ?? false,
        ...(wantsStructured && { stopAfterTools: [RETURN_RESULT_TOOL] }),
        ...(providerOptions && { providerOptions }),
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
      const streamResult = await agent.streamGenerate(userMessage, {
        executionContext,
        ...(signal && { abortSignal: signal }),
        ...(priorMessages && { messages: priorMessages }),
      })

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
      let usage: SubAgentUsage | undefined
      if (fullResult.totalUsage && fullResult.totalUsage.inputTokens !== undefined) {
        const totalUsage = fullResult.totalUsage
        usage = {
          modelName: model,
          inputTokens: totalUsage.inputTokens ?? 0,
          outputTokens: totalUsage.outputTokens ?? 0,
          totalTokens: totalUsage.totalTokens ?? 0,
          cachedInputTokens: totalUsage.cachedInputTokens ?? 0,
          cacheWriteInputTokens: totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
          steps: Array.isArray(fullResult.steps) ? fullResult.steps.length : 0,
        }
        // Keep emitting the transient `usage` event for the live SSE cost path
        // (run-agent.ts → computeDebugTurnStats); the same data now also rides
        // back on the result envelope via `usage` below.
        onEvent({ event: 'usage', agent: id, detail: JSON.stringify(usage) })
      }

      const toolResults: Array<{ toolName: string; result: unknown }> = []
      // The worker's `returnResult` call carries the structured payload as its
      // INPUT (args). Capture it here — alongside the existing result extraction —
      // so it survives to the structured-return step below.
      //
      // Invariant this relies on: `finalResult.toolCalls` (ai-lib's getFinalResult)
      // resolves the FINAL step's calls, and `stopAfterTools: [returnResult]` ends the
      // run on the step that calls it — so the terminal call is present here. If that
      // stop mechanism ever changes (e.g. the bounded last-step `prepareStep` forcing
      // noted above), re-verify the call still lands in this list or the payload will
      // be silently dropped and every structured run misreported as "not returned".
      //
      // We capture the payload ONLY from a SUCCESSFUL tool result — a record that
      // carries an `output`/`result` and is not flagged `invalid`. `stopAfterTools`
      // only fires on a schema-valid call, but the run is also bounded by
      // `stepCountIs(maxSteps)`: if the model emits a SCHEMA-INVALID `returnResult` on
      // its final allowed step, validation fails (so the stop-after gate does not
      // fire), the run ends via step exhaustion, and the AI SDK still surfaces that
      // invalid call in the final `toolCalls` with `invalid: true` and its raw,
      // schema-violating input (no `output`). Trusting mere presence would pass that
      // violating payload through as a success; requiring a successful result keeps
      // the "validated payload only" guarantee and routes the invalid case to the
      // not-returned error below.
      let returnResultInput: unknown
      if (finalResult.toolCalls && Array.isArray(finalResult.toolCalls)) {
        for (const call of finalResult.toolCalls) {
          if (call && typeof call === 'object' && 'toolName' in call) {
            const record: Record<string, unknown> = call as Record<string, unknown>
            toolResults.push({
              toolName: record.toolName as string,
              result: 'result' in record ? record.result : ('output' in record ? record.output : undefined),
            })
            const succeeded: boolean = record.invalid !== true && ('output' in record || 'result' in record)
            if (wantsStructured && record.toolName === RETURN_RESULT_TOOL && succeeded) {
              returnResultInput = 'input' in record ? record.input : record.args
            }
          }
        }
      }

      const sessionSteps = (Array.isArray(fullResult.steps) ? fullResult.steps : []) as StepForSession[]
      const session = buildSessionTranscript(sessionSteps, userMessage, priorMessages)

      // Artifacts = every file CONFIRMED written across ALL steps, unioned + deduped
      // from two complementary sources:
      //  - `extractFileAccess(sessionSteps, 'write', { confirmedOnly: true })` reads
      //    each write tool's INPUT `.path` across every step. This is the workhorse:
      //    the primary editor `str_replace_based_edit_tool` returns a status STRING
      //    ("Successfully replaced text.") — NOT `{ path }` (see text-editor-workspace.ts)
      //    — so a result-based scan misses every edit it makes. `confirmedOnly` gates
      //    the text editor on a success result so a `create` that wrote nothing (no
      //    matching upload, etc.) is NOT reported as a produced file. (Staleness uses
      //    the ungated `session.filesWritten`, where over-inclusion is harmless.)
      //  - `extractArtifacts(toolResults)` reads a write tool's RESULT `.path`, kept as a
      //    defensive net for any object-returning write tool (inherently success-gated:
      //    a failure returns no `{ path }`).
      // Both aggregate across all steps, which matters because the AI SDK's `finalResult`
      // tool calls describe only the LAST step — in structured mode the terminal
      // `returnResult` call is that step, so real writes always land in earlier ones.
      const artifacts: string[] = [
        ...new Set<string>([
          ...extractArtifacts(toolResults),
          ...extractFileAccess(sessionSteps, 'write', { confirmedOnly: true }).map((f: FileAccess): string => f.path),
        ]),
      ]

      // Single builder for every result this run returns — the success path and the
      // error exits below. It closes over the outputs gathered above (artifacts,
      // docPath, visualOutputs, usage, session) so an error exit never silently drops
      // a doc or visual the worker produced before failing, and adding an envelope
      // field later means editing one place, not several.
      const buildResult = (summary: string, status: 'success' | 'error', structured?: unknown): SubAgentResult => ({
        summary,
        artifacts,
        status,
        ...(docPath && { docPath }),
        ...(visualOutputs.length > 0 && { visualOutputs }),
        ...(usage && { usage }),
        ...(structured !== undefined && { structuredOutput: structured }),
        _session: session,
        _sessionAgent: id,
      })

      // A 'length' finish means the model hit the output-token cap mid-step — typically a
      // single file write too large to emit in one call. The truncated tool call is never
      // applied (the edit is silently lost), so the run can "finish" having written nothing
      // while looking successful. Report it as an error — before emitting `completed`, so a
      // truncated run surfaces only an `error` event, not a misleading completed-then-error
      // pair — letting the orchestrator's await-then-retry path re-dispatch (the message
      // tells it to write incrementally) rather than declaring a half-built result done.
      if (fullResult.finishReason === 'length') {
        logger.warn('subAgentRunner.execute.truncated', { agent: name, artifactCount: artifacts.length })
        onEvent({ event: 'error', agent: name, detail: 'Output truncated at the token limit before completion' })
        return buildResult(
          'Build hit the output-token limit before finishing (finishReason: length) — the last edit was too large to emit in one call and was NOT applied. Retry by writing the file incrementally: create it with a skeleton plus the first section, then use str_replace to add each remaining section so no single write is huge.',
          'error',
        )
      }

      // Structured returns: the terminal `returnResult` call carries the payload as its
      // input, which the AI SDK ALREADY validated against the caller's schema — only a
      // schema-valid, successful call satisfies `stopAfterTools` and ends the run. We
      // trust that validation and pass the value through as-is rather than re-parsing:
      // a re-`safeParse` here would re-run the schema's INPUT-side validators on an
      // already-parsed value, double-applying any `.transform()`/`.pipe()`/coercion and
      // falsely rejecting a valid transformed payload. If the worker never returned a
      // valid result (exhausted its steps without a good `returnResult` call), resolve
      // as a distinct `error` — never a silent success — and BEFORE emitting
      // `completed`, so the failure surfaces a single `error` event (same discipline as
      // the length-truncation guard). Errored runs carry their message in `summary`; the
      // registry copies it onto the envelope's `error` field (sub-agent-job-registry).
      if (returnFormat !== 'summary' && returnResultInput === undefined) {
        logger.warn('subAgentRunner.structuredOutput.notReturned', { agent: name })
        onEvent({ event: 'error', agent: name, detail: 'Worker did not return a structured result' })
        return buildResult(
          'worker did not return a structured result matching the requested schema (returnResult was never called successfully within the step budget)',
          'error',
        )
      }
      const structuredOutput: unknown = returnFormat !== 'summary' ? returnResultInput : undefined

      onEvent({ event: 'completed', agent: name, detail: fullText })

      // A structured run stops on the `returnResult` call, so the model never gets a
      // closing prose turn — `fullText` is only mid-work narration and may be empty.
      // Keep the envelope `summary` non-empty (the payload itself rides
      // `structuredOutput`) so downstream consumers that surface `summary` don't show a
      // blank result for a run that actually succeeded.
      const finalSummary: string = returnFormat !== 'summary' && fullText.trim() === ''
        ? 'Completed the task and returned a structured result.'
        : fullText

      return buildResult(finalSummary, 'success', structuredOutput)
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

/**
 * Name of the synthetic terminal tool injected for structured returns. The
 * worker calls it exactly once with its result; `stopAfterTools` ends the run.
 */
const RETURN_RESULT_TOOL = 'returnResult' as const

/** Appended to the worker's system prompt only when a schema return is requested. */
const RETURN_RESULT_INSTRUCTION: string =
  'When you have finished the task, call the `returnResult` tool exactly once with your final result. ' +
  'Its input schema defines the exact shape to return. Calling it ends your run, so call it only when the work is complete.'

/**
 * Build the synthetic terminal tool whose input schema IS the caller's schema.
 * Its executor just echoes the (already SDK-validated) input back; the payload is
 * read off the tool call's input in {@link SubAgentRunner}. The AI SDK validates
 * the input against `schema` before executing, and lets the model retry a
 * malformed call within the step budget — so validation/retry is native, not a
 * hand-rolled loop.
 */
function buildReturnResultTool(schema: z.ZodType): Tool {
  return createTool(
    'Return your final result for this task. Call this exactly once, as your final action, with your result matching the input schema. Calling it ends your run.',
    schema,
    async (input: unknown) => input,
  )
}
