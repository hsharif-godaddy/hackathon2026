/**
 * Generic prompt classification framework.
 *
 * Agents opt in by declaring `classifyInitialPrompt` and/or `classifyPrompt`
 * on their AgentConfig. The framework runs the appropriate method in parallel
 * with context assembly, skipping classification on continuation turns (where
 * the previous assistant turn ended with a stop tool).
 */

import type { ClassifyPromptOptions, ClassificationResult } from '@airo/ai-lib'

import { logger } from '../logging/index.js'

export interface ClassificationContextMessage {
  role: 'user'
  content: string
  cachePoint?: { type: 'ephemeral' }
}

interface AgentConfigLike {
  stopAfterTools?: string[]
  classifyInitialPrompt?: (opts: ClassifyPromptOptions) => Promise<ClassificationResult | null>
  classifyPrompt?: (opts: ClassifyPromptOptions) => Promise<ClassificationResult | null>
}

interface HistoryMessage {
  role?: unknown
  content?: unknown
}

/**
 * Detect whether the current user message is a continuation (response to a
 * stop tool) rather than a new request. Checks if the last assistant turn
 * ended with a tool call matching the agent's stopAfterTools list.
 */
export function isContinuationTurn(
  historyMessages: ReadonlyArray<HistoryMessage>,
  stopAfterTools: ReadonlyArray<string>,
): boolean {
  if (stopAfterTools.length === 0) return false

  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const msg = historyMessages[i]
    if (!msg || msg.role !== 'assistant') continue
    const content: unknown = msg.content
    if (!Array.isArray(content)) return false
    return content.some(
      (part: unknown): boolean =>
        !!part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'tool-call' &&
        typeof (part as { toolName?: unknown }).toolName === 'string' &&
        stopAfterTools.includes((part as { toolName: string }).toolName),
    )
  }
  return false
}

export interface RunClassificationOptions {
  agentConfig: AgentConfigLike
  prompt: string
  historyMessages: ReadonlyArray<HistoryMessage>
  /** Whether this is the first turn on a new app. Caller computes this via
   *  dropTrailingPrompt (which correctly handles the pre-persisted message). */
  isInitialPrompt: boolean
  appId?: string
  conversationId?: string
  templateId?: string
  uploadedFileName?: string
}

/**
 * Run prompt classification for the current turn. Returns a context message
 * to inject after history, or null if classification was skipped/unavailable.
 *
 * Rules:
 * - If agent defines neither classifier method → null
 * - If continuation turn (last assistant ended with stop tool) → null
 * - If initial prompt (no history) and `classifyInitialPrompt` defined → call it
 * - If subsequent turn and `classifyPrompt` defined → call it
 * - On error → null (classification never blocks)
 */
export async function runClassification(opts: RunClassificationOptions): Promise<ClassificationContextMessage | null> {
  const { agentConfig, prompt, historyMessages, isInitialPrompt, appId, conversationId, templateId, uploadedFileName } = opts
  const { classifyInitialPrompt, classifyPrompt, stopAfterTools } = agentConfig

  if (!classifyInitialPrompt && !classifyPrompt) return null

  if (isContinuationTurn(historyMessages, stopAfterTools ?? [])) {
    logger.info('classification.skipped', { appId, conversationId, reason: 'continuation_turn' })
    return null
  }
  const classifierFn: ((opts: ClassifyPromptOptions) => Promise<ClassificationResult | null>) | undefined =
    isInitialPrompt ? classifyInitialPrompt : classifyPrompt

  if (!classifierFn) return null

  const attachments: ClassifyPromptOptions['attachments'] = uploadedFileName
    ? [{ name: uploadedFileName }]
    : undefined

  try {
    const result: ClassificationResult | null = await classifierFn({
      prompt,
      appId,
      conversationId,
      isInitialPrompt,
      templateId,
      attachments,
    })

    if (!result) return null

    logger.info('classification.result', { appId, conversationId, class: result.class, isInitialPrompt })

    return {
      role: 'user',
      content: `## Request classification\n\n<classification class="${result.class}">${result.reason}</classification>`,
    }
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error)
    logger.warn('classification.error', { appId, conversationId, isInitialPrompt, error: message })
    return null
  }
}
