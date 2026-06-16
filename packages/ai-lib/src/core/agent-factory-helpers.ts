/**
 * Pure stateless helpers for AgentFactory / AgentWrapper.
 *
 * Extracted verbatim from agent-factory.ts. agent-factory.ts re-exports the
 * public ones (e.g. hasSuccessfulToolCall), so the split is invisible to importers.
 */

import { buildLitellmMetadataFromContext, LlmCallSource } from '@airo/ai-grants'
import type { LitellmMetadata } from '../providers/unified-provider.js'
import type { ResolvedTurnState } from './agent-factory-types.js'

/**
 * Filter an object to only include JSON-serializable values (primitives, plain objects, arrays).
 * Strips class instances, functions, Timeouts, Maps, etc. that would cause issues during logging.
 */
export function filterSerializableValues(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = value
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    } else if (Array.isArray(value)) {
      result[key] = value
    } else if (typeof value === 'object' && value.constructor === Object) {
      result[key] = value
    }
    // Skip: class instances, functions, Maps, Sets, Timeouts, etc.
  }
  return result
}

/**
 * Like the AI SDK's `hasToolCall`, but only triggers when the tool call
 * is considered successful because it produced a matching `tool-result`.
 * This allows the LLM to retry when a stopAfterTools call results in a
 * `tool-error` (for example, when a tool call fails validation).
 */
export function hasSuccessfulToolCall(toolName: string) {
  return ({ steps }: { steps: Array<{ content: Array<{ type: string; toolName?: string; toolCallId?: string }> }> }): boolean => {
    for (const step of steps) {
      const matchingCall = step.content.find(
        item => item.type === 'tool-call' && item.toolName === toolName
      )
      if (!matchingCall) continue

      // Only stop if the tool call produced a successful result
      const hasResult = step.content.some(
        item => item.type === 'tool-result' && item.toolCallId === matchingCall.toolCallId
      )
      if (hasResult) return true
    }
    return false
  }
}

/**
 * Extract LiteLLM metadata from execution context for per-request cost tracking
 * Uses the new grant-aware buildLitellmMetadataFromContext helper.
 *
 * @param executionContext - The execution context passed from the caller
 * @param agentId - The keyword identifier of the current agent (e.g., 'develop', 'initial')
 * @returns LiteLLM metadata object with grant user or fallback to customerId
 */
export function extractLitellmMetadata(
  executionContext?: Record<string, unknown>,
  agentId?: string
): LitellmMetadata | null {
  return buildLitellmMetadataFromContext(executionContext, {
    agentId,
    source: LlmCallSource.UserChat,
  })
}

/**
 * Inspect a Vercel AI SDK tool and return the provider it was defined for, if any.
 * Provider-defined tools have `type: 'provider'` and an `id` like `anthropic.text_editor_20250728`;
 * the prefix before the first `.` is the native provider.
 */
export function detectToolNativeProvider(tool: unknown): string | undefined {
  if (!tool || typeof tool !== 'object') return undefined
  const t = tool as { type?: unknown; id?: unknown }
  if (t.type !== 'provider' && t.type !== 'provider-defined') return undefined
  if (typeof t.id !== 'string') return undefined
  const dot = t.id.indexOf('.')
  return dot > 0 ? t.id.slice(0, dot) : undefined
}

// Symbol-keyed so the slot can't collide with any caller-supplied AgentContext field.
export const RESOLVED_TURN_STATE = Symbol('airo.resolvedTurnState')

export function readResolvedTurnState(experimentalContext: unknown): ResolvedTurnState | undefined {
  if (experimentalContext === null || typeof experimentalContext !== 'object') return undefined
  const slot = (experimentalContext as Record<PropertyKey, unknown>)[RESOLVED_TURN_STATE]
  return (slot && typeof slot === 'object') ? slot as ResolvedTurnState : undefined
}
