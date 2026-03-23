/**
 * Publish Client AI Tool Unit Tests
 *
 * Tests for the publish eligibility pre-validation check that prevents
 * starting the ~35s publish workflow when the user lacks permission.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock dependencies before importing the tool
vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

vi.mock('../../server/ai-lib-websocket-server.js', () => ({
  getClientActionService: vi.fn(),
}))

vi.mock('../publish-client-tool.js', () => ({
  executePublish: vi.fn(),
}))

vi.mock('../memory-tool.js', () => ({
  MemoryTool: vi.fn().mockImplementation(() => ({
    readMemory: vi.fn(),
    setMemory: vi.fn(),
  })),
}))

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn(),
  })),
}))

vi.mock('../../utils/domain-validation.js', () => ({
  validateDomainName: vi.fn().mockReturnValue({ valid: true }),
}))

import { publishClientAITool } from '../ai-lib-tools/publish-client.js'
import { getClientActionService } from '../../server/ai-lib-websocket-server.js'
import { executePublish } from '../publish-client-tool.js'

/**
 * Helper to call the tool's execute function with proper AI SDK context wrapping.
 * createTool wraps execute so context arrives via executionOptions.experimental_context.
 */
function executeTool(input: Record<string, unknown>, context: Record<string, unknown>) {
  return (publishClientAITool as any).execute(input, {
    experimental_context: context,
  })
}

describe('publishClientAITool', () => {
  const mockClientActionService = {
    executeAction: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientActionService).mockReturnValue(mockClientActionService as any)
  })

  describe('publish eligibility pre-validation', () => {
    it('should return upgrade message when canPublish is false', async () => {
      const context = {
        metadata: {
          appId: 'test-app-id',
          permissions: { canPublish: false },
        },
        socketId: 'test-socket-id',
      }

      const result = await executeTool({}, context)

      expect(result).toMatchObject({
        success: false,
        requiresUpgrade: true,
        publishStarted: false,
      })
      expect(result.message).toContain('Airo Plus subscription')
      expect(result.message).toContain('Do not call publishStatus')
      expect(executePublish).not.toHaveBeenCalled()
    })

    it('should return upgrade message when permissions are undefined', async () => {
      const context = {
        metadata: {
          appId: 'test-app-id',
        },
        socketId: 'test-socket-id',
      }

      const result = await executeTool({}, context)

      expect(result).toMatchObject({
        success: false,
        requiresUpgrade: true,
        publishStarted: false,
      })
      expect(result.message).toContain('Airo Plus subscription')
      expect(executePublish).not.toHaveBeenCalled()
    })

    it('should check permission before socket/service lookups', async () => {
      // No socketId, no permissions — should get upgrade message, not socket error
      const context = {
        metadata: {
          appId: 'test-app-id',
        },
      }

      const result = await executeTool({}, context)

      expect(result).toMatchObject({
        success: false,
        requiresUpgrade: true,
      })
      expect(executePublish).not.toHaveBeenCalled()
    })

    it('should proceed to executePublish when canPublish is true', async () => {
      vi.mocked(executePublish).mockResolvedValue({
        success: true,
        commitHash: 'abc1234',
      } as any)

      mockClientActionService.executeAction.mockResolvedValue({
        success: true,
        result: { domains: [] },
      })

      const context = {
        metadata: {
          appId: 'test-app-id',
          permissions: { canPublish: true },
        },
        socketId: 'test-socket-id',
      }

      const result = await executeTool({}, context)

      expect(executePublish).toHaveBeenCalledWith(
        { appId: 'test-app-id' },
        mockClientActionService
      )
      expect(result.success).toBe(true)
    })
  })
})
