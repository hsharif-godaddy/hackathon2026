import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Tool } from 'ai'
import { createHandoffTool, type HandoffStateManager } from '../handoff-helpers.js'

vi.mock('@airo/ai-common', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

/** Type for the internal execute function of AI SDK tools */
type ToolExecuteFunction = (
  params: { targetAgent: string; prompt: string; planTitle?: string },
  context?: Record<string, unknown>
) => Promise<Record<string, unknown>>

/**
 * Helper to execute a tool created by createHandoffTool.
 * The AI SDK Tool type stores the execute function internally.
 */
async function executeTool(
  tool: Tool,
  params: { targetAgent: string; prompt: string; planTitle?: string },
  context: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const executeFunc = (tool as unknown as { execute: ToolExecuteFunction }).execute
  return executeFunc(params, context)
}

describe('createHandoffTool', () => {
  let mockStateManager: HandoffStateManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockStateManager = {
      switchAgent: vi.fn().mockResolvedValue(true),
      getCurrentAgent: vi.fn(),
      setSessionMetadata: vi.fn(),
      getSessionMetadata: vi.fn(),
      getLastHandoffPrompt: vi.fn(),
      clearLastHandoffPrompt: vi.fn(),
      clearSession: vi.fn()
    }
  })

  describe('self-handoff prevention', () => {
    it('should reject handoff when target agent is the same as source agent', async () => {
      const tool = createHandoffTool({
        sourceAgentId: 'develop',
        validTargets: ['marketing', 'commerce'],
        stateManager: mockStateManager,
        sessionId: 'test-session'
      })

      const result = await executeTool(
        tool,
        { targetAgent: 'develop', prompt: 'Test handoff' },
        { sessionId: 'test-session' }
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Self-handoff not allowed')
      expect(result.message).toContain('You are the develop agent')
      expect(result.message).toContain('cannot hand off to yourself')
      expect(result.instruction).toBe('Process this request yourself instead of handing off.')
      expect(mockStateManager.switchAgent).not.toHaveBeenCalled()
    })

    it('should allow handoff to a different valid target agent', async () => {
      const tool = createHandoffTool({
        sourceAgentId: 'develop',
        validTargets: ['marketing', 'commerce'],
        stateManager: mockStateManager,
        sessionId: 'test-session'
      })

      const result = await executeTool(
        tool,
        { targetAgent: 'marketing', prompt: 'Need SEO help' },
        { sessionId: 'test-session' }
      )

      // Verify new minimal format (no internal details exposed)
      expect(result).toEqual({
        success: true,
        message: 'Handoff complete',
        timestamp: expect.any(String)
      })
      // Verify fields are NOT present (security requirement)
      expect(result).not.toHaveProperty('targetAgent')
      expect(result).not.toHaveProperty('prompt')
      // Verify prompt is not leaked in any field (security requirement)
      expect(result.message).not.toContain('Need SEO help')
      expect(result.message).not.toContain('marketing')
      expect(JSON.stringify(result)).not.toContain('Need SEO help')
      // Verify state manager still receives the data (not lost)
      expect(mockStateManager.switchAgent).toHaveBeenCalledWith(
        'test-session',
        'marketing',
        'Need SEO help'
      )
    })

    it('should reject handoff to an invalid target (not in validTargets)', async () => {
      const tool = createHandoffTool({
        sourceAgentId: 'develop',
        validTargets: ['marketing'],
        stateManager: mockStateManager,
        sessionId: 'test-session'
      })

      const result = await executeTool(
        tool,
        { targetAgent: 'unknown-agent', prompt: 'Test' },
        { sessionId: 'test-session' }
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Handoff to unknown-agent is not configured')
      expect(result.availableTargets).toEqual(['marketing'])
      expect(mockStateManager.switchAgent).not.toHaveBeenCalled()
    })

    it('should check self-handoff before validating against validTargets', async () => {
      // Even if 'develop' were somehow in validTargets, self-handoff should be blocked first
      const tool = createHandoffTool({
        sourceAgentId: 'develop',
        validTargets: ['develop', 'marketing'], // develop incorrectly in targets
        stateManager: mockStateManager,
        sessionId: 'test-session'
      })

      const result = await executeTool(
        tool,
        { targetAgent: 'develop', prompt: 'Test' },
        { sessionId: 'test-session' }
      )

      // Should still be blocked by self-handoff check, not pass validation
      expect(result.success).toBe(false)
      expect(result.error).toBe('Self-handoff not allowed')
      expect(mockStateManager.switchAgent).not.toHaveBeenCalled()
    })
  })

  describe('handoff without state manager', () => {
    it('should return informational message when no state manager is provided', async () => {
      const tool = createHandoffTool({
        sourceAgentId: 'initial',
        validTargets: ['develop']
      })

      const result = await executeTool(
        tool,
        { targetAgent: 'develop', prompt: 'Initial setup complete' }
      )

      expect(result.success).toBe(true)
      expect(result.warning).toContain('No state manager')
      expect(result.timestamp).toBeDefined()
      // Verify fields are NOT present (even in no-state-manager case)
      expect(result).not.toHaveProperty('targetAgent')
      expect(result).not.toHaveProperty('prompt')
      // Verify prompt is not leaked in any field
      expect(result.message).not.toContain('Initial setup complete')
      expect(result.message).not.toContain('develop')
      expect(JSON.stringify(result)).not.toContain('Initial setup complete')
    })

    it('should still block self-handoff even without state manager', async () => {
      const tool = createHandoffTool({
        sourceAgentId: 'develop',
        validTargets: ['marketing']
      })

      const result = await executeTool(
        tool,
        { targetAgent: 'develop', prompt: 'Test' }
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Self-handoff not allowed')
    })
  })

  describe('planTitle argument', () => {
    // Verifies planTitle is accepted by the schema but NOT forwarded to switchAgent (metadata-only)
    it('accepts planTitle without error and returns success', async () => {
      const tool = createHandoffTool({
        sourceAgentId: 'initial',
        validTargets: ['develop'],
        stateManager: mockStateManager,
        sessionId: 'test-session'
      })

      const result = await executeTool(
        tool,
        { targetAgent: 'develop', prompt: 'Build the homepage', planTitle: 'Homepage Design' },
        { sessionId: 'test-session' }
      )

      expect(result).toMatchObject({ success: true })
      expect(mockStateManager.switchAgent).toHaveBeenCalledWith(
        'test-session',
        'develop',
        'Build the homepage'
      )
    })

    it('works fine without planTitle (backward compat)', async () => {
      const tool = createHandoffTool({
        sourceAgentId: 'initial',
        validTargets: ['develop'],
        stateManager: mockStateManager
      })

      const result = await executeTool(
        tool,
        { targetAgent: 'develop', prompt: 'Build the homepage' },
        { sessionId: 'test-session' }
      )

      expect(result).toMatchObject({ success: true })
    })
  })
})
