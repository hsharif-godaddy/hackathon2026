import { describe, it, expect } from 'vitest'
import { extractBudgetContext, withBudgetFields, type ToolBudgetContext } from '../tool-budget-context.js'
import type { AgentContext } from '@airo/ai-lib'

describe('tool-budget-context', () => {
  describe('extractBudgetContext', () => {
    it('extracts budget fields when present in context metadata', () => {
      const context = {
        metadata: {
          bmsBudgetId: 'budget-123',
          budgetSessionId: 'session-456',
          appId: 'app-1',
        },
      } as AgentContext

      const result = extractBudgetContext(context)

      expect(result).toEqual({
        bmsBudgetId: 'budget-123',
        budgetSessionId: 'session-456',
      })
    })

    it('returns undefined values when budget fields not in metadata', () => {
      const context = {
        metadata: {
          appId: 'app-1',
        },
      } as AgentContext

      const result = extractBudgetContext(context)

      expect(result).toEqual({
        bmsBudgetId: undefined,
        budgetSessionId: undefined,
      })
    })

    it('returns undefined values when context is undefined', () => {
      const result = extractBudgetContext(undefined)

      expect(result).toEqual({
        bmsBudgetId: undefined,
        budgetSessionId: undefined,
      })
    })

    it('returns undefined values when metadata is undefined', () => {
      const context = {} as AgentContext

      const result = extractBudgetContext(context)

      expect(result).toEqual({
        bmsBudgetId: undefined,
        budgetSessionId: undefined,
      })
    })
  })

  describe('withBudgetFields', () => {
    it('adds budget fields when both bmsBudgetId and budgetSessionId are present', () => {
      const baseMetadata = { appId: 'app-1', sessionId: 'sess-1' }
      const budgetContext: ToolBudgetContext = {
        bmsBudgetId: 'budget-123',
        budgetSessionId: 'session-456',
      }

      const result = withBudgetFields(baseMetadata, budgetContext)

      expect(result).toEqual({
        appId: 'app-1',
        sessionId: 'sess-1',
        bmsBudgetId: 'budget-123',
        budgetSessionId: 'session-456',
      })
    })

    it('returns base metadata unchanged when bmsBudgetId is undefined', () => {
      const baseMetadata = { appId: 'app-1', sessionId: 'sess-1' }
      const budgetContext: ToolBudgetContext = {
        bmsBudgetId: undefined,
        budgetSessionId: 'session-456',
      }

      const result = withBudgetFields(baseMetadata, budgetContext)

      expect(result).toEqual({ appId: 'app-1', sessionId: 'sess-1' })
      expect(result).not.toHaveProperty('bmsBudgetId')
      expect(result).not.toHaveProperty('budgetSessionId')
    })

    it('returns base metadata unchanged when budgetSessionId is undefined', () => {
      const baseMetadata = { appId: 'app-1', sessionId: 'sess-1' }
      const budgetContext: ToolBudgetContext = {
        bmsBudgetId: 'budget-123',
        budgetSessionId: undefined,
      }

      const result = withBudgetFields(baseMetadata, budgetContext)

      expect(result).toEqual({ appId: 'app-1', sessionId: 'sess-1' })
      expect(result).not.toHaveProperty('bmsBudgetId')
      expect(result).not.toHaveProperty('budgetSessionId')
    })

    it('returns base metadata unchanged when both budget fields are undefined', () => {
      const baseMetadata = { appId: 'app-1', sessionId: 'sess-1' }
      const budgetContext: ToolBudgetContext = {
        bmsBudgetId: undefined,
        budgetSessionId: undefined,
      }

      const result = withBudgetFields(baseMetadata, budgetContext)

      expect(result).toEqual({ appId: 'app-1', sessionId: 'sess-1' })
      expect(result).not.toHaveProperty('bmsBudgetId')
      expect(result).not.toHaveProperty('budgetSessionId')
    })

    it('returns base metadata unchanged when budgetContext is undefined', () => {
      const baseMetadata = { appId: 'app-1', sessionId: 'sess-1' }

      const result = withBudgetFields(baseMetadata, undefined)

      expect(result).toEqual({ appId: 'app-1', sessionId: 'sess-1' })
      expect(result).not.toHaveProperty('bmsBudgetId')
      expect(result).not.toHaveProperty('budgetSessionId')
    })

    it('preserves all base metadata fields', () => {
      const baseMetadata = {
        appId: 'app-1',
        sessionId: 'sess-1',
        agentId: 'agent-1',
        customerId: 'cust-1',
        subscriptionId: 'sub-1',
      }
      const budgetContext: ToolBudgetContext = {
        bmsBudgetId: 'budget-123',
        budgetSessionId: 'session-456',
      }

      const result = withBudgetFields(baseMetadata, budgetContext)

      expect(result.appId).toBe('app-1')
      expect(result.sessionId).toBe('sess-1')
      expect(result.agentId).toBe('agent-1')
      expect(result.customerId).toBe('cust-1')
      expect(result.subscriptionId).toBe('sub-1')
      expect(result.bmsBudgetId).toBe('budget-123')
      expect(result.budgetSessionId).toBe('session-456')
    })
  })
})
