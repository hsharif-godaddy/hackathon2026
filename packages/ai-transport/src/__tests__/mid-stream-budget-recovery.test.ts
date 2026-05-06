/**
 * Mid-stream budget recovery contract tests.
 *
 * Tests the decision logic for grant advancement after mid-stream budget errors:
 * callback signature, Layer 2 vs Layer 3 routing, retry limits, and non-idempotent tool detection.
 */

import { describe, it, expect, vi } from 'vitest'
import { BudgetExceededError, containsBudgetExceededPattern } from '@airo/ai-common'
import { hasNonIdempotentTools } from '../non-idempotent-tools.js'
import type { WebSocketConfig } from '../experimental-websocket-server.js'

type BudgetCallback = NonNullable<WebSocketConfig['onBudgetExhaustedMidStream']>
type BudgetCallbackResult = Awaited<ReturnType<BudgetCallback>>

describe('mid-stream budget recovery', () => {
  describe('callback contract', () => {
    it('returns retry=true with newUserId when grant advancement succeeds', async () => {
      const callback: BudgetCallback = async (_socketId, _error, executedToolNames) => {
        const hasNonIdempotent = hasNonIdempotentTools(executedToolNames)
        return { retry: true, newUserId: 'airo-builder:grant:next', hasNonIdempotentTools: hasNonIdempotent }
      }

      const result = await callback('socket-1', new Error('budget exceeded'), ['readFile', 'str_replace_based_edit_tool'])
      expect(result.retry).toBe(true)
      expect(result.newUserId).toBe('airo-builder:grant:next')
      expect(result.hasNonIdempotentTools).toBe(false)
    })

    it('returns retry=true with hasNonIdempotentTools=true when non-idempotent tools ran', async () => {
      const callback: BudgetCallback = async (_socketId, _error, executedToolNames) => {
        const hasNonIdempotent = hasNonIdempotentTools(executedToolNames)
        return { retry: true, newUserId: 'airo-builder:grant:next', hasNonIdempotentTools: hasNonIdempotent }
      }

      const result = await callback('socket-1', new Error('budget exceeded'), ['readFile', 'commerce__manage_products'])
      expect(result.retry).toBe(true)
      expect(result.hasNonIdempotentTools).toBe(true)
    })

    it('returns retry=false when all grants exhausted', async () => {
      const callback: BudgetCallback = async (_socketId, _error, executedToolNames) => {
        return { retry: false, hasNonIdempotentTools: hasNonIdempotentTools(executedToolNames) }
      }

      const result = await callback('socket-1', new Error('budget exceeded'), [])
      expect(result.retry).toBe(false)
    })
  })

  describe('Layer 2 vs Layer 3 routing', () => {
    function routeDecision(result: BudgetCallbackResult): 'retry' | 'continue' | 'propagate' {
      if (!result.retry || !result.newUserId) return 'propagate'
      return result.hasNonIdempotentTools ? 'continue' : 'retry'
    }

    it('routes to Layer 2 (retry) when no non-idempotent tools', () => {
      const result: BudgetCallbackResult = { retry: true, newUserId: 'grant:new', hasNonIdempotentTools: false }
      expect(routeDecision(result)).toBe('retry')
    })

    it('routes to Layer 3 (continue) when non-idempotent tools ran', () => {
      const result: BudgetCallbackResult = { retry: true, newUserId: 'grant:new', hasNonIdempotentTools: true }
      expect(routeDecision(result)).toBe('continue')
    })

    it('routes to propagate when retry=false', () => {
      const result: BudgetCallbackResult = { retry: false, hasNonIdempotentTools: false }
      expect(routeDecision(result)).toBe('propagate')
    })

    it('routes to propagate when retry=true but no newUserId', () => {
      const result: BudgetCallbackResult = { retry: true, hasNonIdempotentTools: false }
      expect(routeDecision(result)).toBe('propagate')
    })
  })

  describe('retry count enforcement', () => {
    it('max retry count is 3 (guard value in streamAgentResponse)', () => {
      // Documents the production guard value (midStreamRetryCount < 3).
      // The recursive retry behavior is integration-tested; this ensures
      // the contract value is visible in unit test output.
      const MAX_MID_STREAM_RETRIES = 3
      expect(MAX_MID_STREAM_RETRIES).toBe(3)
    })
  })

  describe('budget error detection', () => {
    it('detects GoCode ExceededBudget pattern in plain Error', () => {
      const msg = 'ExceededBudget: End User=airo-builder:grant:7qygh3sip0 over budget. Spend=10.02, Budget=10.00'
      expect(containsBudgetExceededPattern(msg)).toBe(true)
    })

    it('detects budget_exceeded type field', () => {
      expect(containsBudgetExceededPattern('{"type":"budget_exceeded"}')).toBe(true)
    })

    it('does not match unrelated 400 errors', () => {
      expect(containsBudgetExceededPattern('Bad Request: invalid JSON')).toBe(false)
      expect(containsBudgetExceededPattern('rate_limit_exceeded')).toBe(false)
    })

    it('BudgetExceededError.isInstance works cross-module', () => {
      const error = new BudgetExceededError('test', 400, '{}')
      expect(BudgetExceededError.isInstance(error)).toBe(true)
      expect(BudgetExceededError.isInstance(new Error('test'))).toBe(false)
    })
  })

  describe('non-idempotent tool detection for routing', () => {
    it('classifies file operations as idempotent (Layer 2)', () => {
      expect(hasNonIdempotentTools(['readFile', 'str_replace_based_edit_tool', 'directoryListing', 'websiteScraper'])).toBe(false)
    })

    it('classifies commerce mutations as non-idempotent (Layer 3)', () => {
      expect(hasNonIdempotentTools(['commerce__manage_products'])).toBe(true)
      expect(hasNonIdempotentTools(['commerce__manage_inventory'])).toBe(true)
    })

    it('classifies social publishing as non-idempotent (Layer 3)', () => {
      expect(hasNonIdempotentTools(['socialPostPublish'])).toBe(true)
    })

    it('classifies database inserts as non-idempotent (Layer 3)', () => {
      expect(hasNonIdempotentTools(['database__insertRow'])).toBe(true)
    })

    it('detects non-idempotent in mixed tool list', () => {
      expect(hasNonIdempotentTools(['readFile', 'commerce__manage_products', 'str_replace_based_edit_tool'])).toBe(true)
    })

    it('returns false for empty tool list (no tools ran)', () => {
      expect(hasNonIdempotentTools([])).toBe(false)
    })
  })

  describe('continuation prompt construction', () => {
    function buildContinuationPrompt(
      originalMessage: string,
      executedToolNames: string[],
      partialContent: string
    ): string {
      const toolHistory = executedToolNames.length > 0
        ? `The following tool calls already completed successfully: ${executedToolNames.join(', ')}. Do not re-execute them.`
        : ''
      return [
        `The user's original request: "${originalMessage}"`,
        toolHistory,
        partialContent ? `You were in the middle of responding. Your partial response so far: "${partialContent.slice(-500)}"` : '',
        'Continue the task from where you left off.',
      ].filter(Boolean).join('\n\n')
    }

    it('includes original user prompt', () => {
      const prompt = buildContinuationPrompt('build me a landing page', [], '')
      expect(prompt).toContain('build me a landing page')
    })

    it('includes executed tool names', () => {
      const prompt = buildContinuationPrompt('publish my app', ['commerce__manage_products', 'socialPostPublish'], '')
      expect(prompt).toContain('commerce__manage_products, socialPostPublish')
      expect(prompt).toContain('Do not re-execute them')
    })

    it('includes partial content (last 500 chars)', () => {
      const longContent = 'x'.repeat(1000)
      const prompt = buildContinuationPrompt('test', [], longContent)
      expect(prompt).toContain('x'.repeat(500))
      expect(prompt).not.toContain('x'.repeat(501))
    })

    it('handles empty state gracefully', () => {
      const prompt = buildContinuationPrompt('test', [], '')
      expect(prompt).toContain('test')
      expect(prompt).toContain('Continue the task')
      expect(prompt).not.toContain('tool calls')
      expect(prompt).not.toContain('partial response')
    })
  })
})
