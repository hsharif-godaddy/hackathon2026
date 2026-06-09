import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ConversationRepository } from '../../database/repositories/ConversationRepository.js'
import { persistHandoffAgent } from '../develop-variant.js'
import { runWithProfile } from '../../profiles/index.js'
import type { ProfileData } from '../../profiles/types.js'

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis()
    })
  },
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

describe('Agent Handoff Callback', () => {
  let mockConversationRepo: {
    updateAgentId: ReturnType<typeof vi.fn>
  }
  let logger: any

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks()

    // Create mock repository
    mockConversationRepo = {
      updateAgentId: vi.fn().mockResolvedValue(undefined)
    }

    // Get logger from mock
    const { Logger } = await import('../../logging/index.js')
    logger = Logger.create({ component: 'test' })
  })

  // Mirrors the real WS onAgentChanged wrapper: it delegates the map+persist to
  // the shared persistHandoffAgent seam (so this exercises the wired behavior,
  // not a divergent copy) and re-throws on failure per the fatal contract.
  const createCallback = (conversationRepository: any) => {
    return async (conversationId: string, oldAgentName: string, newAgentName: string, appId?: string) => {
      logger.info('websocket.agent.handoff', {
        conversationId,
        oldAgent: oldAgentName,
        newAgent: newAgentName,
        appId
      })

      try {
        const concreteAgent = await persistHandoffAgent(conversationRepository, conversationId, newAgentName)
        logger.debug('websocket.agent.handoff.updated', {
          conversationId,
          newAgent: concreteAgent
        })
      } catch (error) {
        // Fatal per the ai-transport onAgentChanged contract: log, then rethrow
        // so the turn aborts rather than continuing under an unpersisted agent.
        logger.error('websocket.agent.handoff.update_failed', {
          conversationId,
          oldAgent: oldAgentName,
          newAgent: newAgentName,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    }
  }

  const profile = (partial: Partial<ProfileData> & Pick<ProfileData, 'name' | 'properties'>): ProfileData => ({
    description: '',
    ...partial,
  })

  describe('onAgentChanged callback', () => {
    it('should update agent_id when handoff occurs', async () => {
      const callback = createCallback(mockConversationRepo)

      await callback('conv-123', 'initial', 'develop', 'app-456')

      expect(mockConversationRepo.updateAgentId).toHaveBeenCalledWith('conv-123', 'develop')
      expect(mockConversationRepo.updateAgentId).toHaveBeenCalledTimes(1)
    })

    it('persists base develop even when the active profile carries develop/skill flags (variants flattened #4346)', async () => {
      const callback = createCallback(mockConversationRepo)

      await runWithProfile(
        profile({ name: 'experimental', properties: { 'skill.inbox.enabled': true } }),
        () => callback('conv-123', 'initial', 'develop', 'app-456'),
      )

      expect(mockConversationRepo.updateAgentId).toHaveBeenCalledWith('conv-123', 'develop')
    })

    it('persists base develop when the active profile has no develop/skill flags', async () => {
      const callback = createCallback(mockConversationRepo)

      await runWithProfile(
        profile({ name: 'ds', properties: { 'initial.promptVersion': 'design-system' } }),
        () => callback('conv-123', 'initial', 'develop', 'app-456'),
      )

      expect(mockConversationRepo.updateAgentId).toHaveBeenCalledWith('conv-123', 'develop')
    })

    it('should log handoff event with all context', async () => {
      const callback = createCallback(mockConversationRepo)

      await callback('conv-123', 'initial', 'develop', 'app-456')

      expect(logger.info).toHaveBeenCalledWith('websocket.agent.handoff', {
        conversationId: 'conv-123',
        oldAgent: 'initial',
        newAgent: 'develop',
        appId: 'app-456'
      })
    })

    it('should log success after update', async () => {
      const callback = createCallback(mockConversationRepo)

      await callback('conv-123', 'initial', 'develop', 'app-456')

      expect(logger.debug).toHaveBeenCalledWith('websocket.agent.handoff.updated', {
        conversationId: 'conv-123',
        newAgent: 'develop'
      })
    })

    it('should handle missing appId gracefully', async () => {
      const callback = createCallback(mockConversationRepo)

      await callback('conv-123', 'initial', 'develop')

      expect(mockConversationRepo.updateAgentId).toHaveBeenCalledWith('conv-123', 'develop')
      expect(logger.info).toHaveBeenCalledWith('websocket.agent.handoff', {
        conversationId: 'conv-123',
        oldAgent: 'initial',
        newAgent: 'develop',
        appId: undefined
      })
    })

    it('should handle multiple consecutive handoffs', async () => {
      const callback = createCallback(mockConversationRepo)

      await callback('conv-123', 'initial', 'develop', 'app-456')
      await callback('conv-123', 'develop', 'design', 'app-456')
      await callback('conv-123', 'design', 'marketing', 'app-456')

      expect(mockConversationRepo.updateAgentId).toHaveBeenCalledTimes(3)
      expect(mockConversationRepo.updateAgentId).toHaveBeenNthCalledWith(1, 'conv-123', 'develop')
      expect(mockConversationRepo.updateAgentId).toHaveBeenNthCalledWith(2, 'conv-123', 'design')
      expect(mockConversationRepo.updateAgentId).toHaveBeenNthCalledWith(3, 'conv-123', 'marketing')
    })

    it('should log error when updateAgentId fails', async () => {
      const error = new Error('Database connection failed')
      mockConversationRepo.updateAgentId.mockRejectedValueOnce(error)

      const callback = createCallback(mockConversationRepo)

      await expect(callback('conv-123', 'initial', 'develop', 'app-456')).rejects.toThrow('Database connection failed')

      expect(logger.error).toHaveBeenCalledWith('websocket.agent.handoff.update_failed', {
        conversationId: 'conv-123',
        oldAgent: 'initial',
        newAgent: 'develop',
        error: 'Database connection failed'
      })
    })

    it('should rethrow when updateAgentId fails (fatal per transport contract)', async () => {
      const error = new Error('Database error')
      mockConversationRepo.updateAgentId.mockRejectedValueOnce(error)

      const callback = createCallback(mockConversationRepo)

      // Must propagate so the turn aborts — a swallowed failure would leave the
      // turn running under an agent that was never persisted, silently reverting
      // the handoff on the next reload.
      await expect(callback('conv-123', 'initial', 'develop', 'app-456')).rejects.toThrow('Database error')
    })

    it('should handle non-Error thrown values', async () => {
      mockConversationRepo.updateAgentId.mockRejectedValueOnce('String error')

      const callback = createCallback(mockConversationRepo)

      await expect(callback('conv-123', 'initial', 'develop', 'app-456')).rejects.toBe('String error')

      expect(logger.error).toHaveBeenCalledWith('websocket.agent.handoff.update_failed', {
        conversationId: 'conv-123',
        oldAgent: 'initial',
        newAgent: 'develop',
        error: 'String error'
      })
    })

    it('should work with different agent combinations', async () => {
      const callback = createCallback(mockConversationRepo)

      // Test various agent combinations
      const combinations = [
        ['initial', 'develop'],
        ['develop', 'design'],
        ['design', 'marketing'],
        ['marketing', 'commerce'],
        ['initial', 'commerce']
      ]

      for (const [oldAgent, newAgent] of combinations) {
        await callback('conv-test', oldAgent, newAgent, 'app-test')
      }

      expect(mockConversationRepo.updateAgentId).toHaveBeenCalledTimes(combinations.length)
    })
  })

  describe('getLatestConversationForApp callback', () => {
    let mockConversationRepoWithLatest: {
      getLatestForApp: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      mockConversationRepoWithLatest = {
        getLatestForApp: vi.fn()
      }
    })

    // Helper to create the getLatestConversationForApp callback
    const createGetLatestCallback = (conversationRepository: any) => {
      return async (appId: string) => {
        const latest = await conversationRepository.getLatestForApp(appId)
        return latest?.id ?? null
      }
    }

    it('should return latest conversation id for app', async () => {
      mockConversationRepoWithLatest.getLatestForApp.mockResolvedValue({
        id: 'conv-latest',
        appId: 'app-123',
        agentId: 'develop',
        title: 'Test',
        createdAt: new Date(),
        updatedAt: new Date()
      })

      const callback = createGetLatestCallback(mockConversationRepoWithLatest)
      const result = await callback('app-123')

      expect(result).toBe('conv-latest')
      expect(mockConversationRepoWithLatest.getLatestForApp).toHaveBeenCalledWith('app-123')
    })

    it('should return null when no conversation exists for app', async () => {
      mockConversationRepoWithLatest.getLatestForApp.mockResolvedValue(null)

      const callback = createGetLatestCallback(mockConversationRepoWithLatest)
      const result = await callback('app-no-history')

      expect(result).toBeNull()
      expect(mockConversationRepoWithLatest.getLatestForApp).toHaveBeenCalledWith('app-no-history')
    })

    it('should handle multiple apps independently', async () => {
      mockConversationRepoWithLatest.getLatestForApp
        .mockResolvedValueOnce({ id: 'conv-app1', appId: 'app-1' })
        .mockResolvedValueOnce({ id: 'conv-app2', appId: 'app-2' })
        .mockResolvedValueOnce(null)

      const callback = createGetLatestCallback(mockConversationRepoWithLatest)

      const result1 = await callback('app-1')
      const result2 = await callback('app-2')
      const result3 = await callback('app-3')

      expect(result1).toBe('conv-app1')
      expect(result2).toBe('conv-app2')
      expect(result3).toBeNull()
    })
  })
})
