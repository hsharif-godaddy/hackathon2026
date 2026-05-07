/**
 * Unit tests for publishing skill tools (`publishTool`, `statusTool`).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../../logging/index.js', () => {
  const instance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => instance,
  }
  return {
    logger: instance,
    Logger: { create: () => instance },
  }
})

vi.mock('../../../../server/ai-lib-websocket-server.js', () => ({
  getClientActionService: vi.fn(),
}))

vi.mock('../../../../tools/publish-client-tool.js', () => ({
  executePublish: vi.fn(),
}))

vi.mock('../../../../tools/memory-tool.js', () => ({
  MemoryTool: vi.fn().mockImplementation(() => ({
    readMemory: vi.fn(),
    setMemory: vi.fn(),
  })),
}))

vi.mock('../../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn(),
  })),
}))

vi.mock('../../../../utils/domain-validation.js', () => ({
  validateDomainName: vi.fn().mockReturnValue({ valid: true }),
}))

vi.mock('../../../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForPublishSupervisor: vi.fn(),
  },
}))

import { publishTool, statusTool } from '../index.js'
import { AppRepository } from '../../../../database/repositories/AppRepository.js'
import { getClientActionService } from '../../../../server/ai-lib-websocket-server.js'
import { executePublish } from '../../../../tools/publish-client-tool.js'
import { MemoryTool } from '../../../../tools/memory-tool.js'
import { DevSupervisorClientFactory } from '../../../../utils/dev-supervisor-client-factory.js'
import { validateDomainName } from '../../../../utils/domain-validation.js'

const memoryInstance = vi.mocked(MemoryTool).mock.results[0].value as {
  readMemory: ReturnType<typeof vi.fn>
  setMemory: ReturnType<typeof vi.fn>
}
const appRepoInstance = vi.mocked(AppRepository).mock.results[0].value as {
  findById: ReturnType<typeof vi.fn>
}

/** Same as registerSkillTools in packages/ai-skills/src/build-skill-tools.ts */
function runPublishTool(
  input: Record<string, unknown>,
  executionOptions: { experimental_context?: unknown }
) {
  const context = executionOptions?.experimental_context
  return publishTool.execute(input, context)
}

function runStatusTool(
  input: Record<string, unknown>,
  executionOptions: { experimental_context?: unknown }
) {
  const context = executionOptions?.experimental_context
  return statusTool.execute(input, context)
}

describe('publishing skill publish-tools', () => {

  describe('publishTool', () => {
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

        const result = await runPublishTool({}, { experimental_context: context })

        expect(result).toMatchObject({
          success: false,
          requiresUpgrade: true,
          publishStarted: false,
        })
        expect(result.message).toContain('Upgrade to publish')
        expect(result.message).toContain('Do not call publishing__status')
        expect(executePublish).not.toHaveBeenCalled()
      })

      it('should return upgrade message when permissions are undefined', async () => {
        const context = {
          metadata: {
            appId: 'test-app-id',
          },
          socketId: 'test-socket-id',
        }

        const result = await runPublishTool({}, { experimental_context: context })

        expect(result).toMatchObject({
          success: false,
          requiresUpgrade: true,
          publishStarted: false,
        })
        expect(result.message).toContain('Upgrade to publish')
        expect(executePublish).not.toHaveBeenCalled()
      })

      it('should check permission before socket/service lookups', async () => {
        const context = {
          metadata: {
            appId: 'test-app-id',
          },
        }

        const result = await runPublishTool({}, { experimental_context: context })

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

        const result = await runPublishTool({}, { experimental_context: context })

        expect(executePublish).toHaveBeenCalledWith(
          { appId: 'test-app-id' },
          mockClientActionService
        )
        expect(result.success).toBe(true)
      })

      it('should forward commitHash to executePublish when provided', async () => {
        vi.mocked(executePublish).mockResolvedValue({ success: true, commitHash: 'deadbeef' } as any)
        mockClientActionService.executeAction.mockResolvedValue({ success: true, result: { domains: [] } })

        const context = {
          metadata: { appId: 'app-1', permissions: { canPublish: true } },
          socketId: 'sock-1',
        }

        await runPublishTool({ commitHash: 'deadbeef' }, { experimental_context: context })

        expect(executePublish).toHaveBeenCalledWith(
          { appId: 'app-1', commitHash: 'deadbeef' },
          mockClientActionService
        )
      })

      it('throws when executePublish returns success: false', async () => {
        vi.mocked(executePublish).mockResolvedValue({
          success: false,
          error: 'Build failed',
          exitCode: 1,
        } as any)
        mockClientActionService.executeAction.mockResolvedValue({ success: true, result: { domains: [] } })

        const context = {
          metadata: { appId: 'app-1', permissions: { canPublish: true } },
          socketId: 'sock-1',
        }

        await expect(runPublishTool({}, { experimental_context: context })).rejects.toThrow(
          'Publish failed: Build failed'
        )
      })
    })

    describe('domain logic after successful publish', () => {
      const baseContext = {
        metadata: {
          appId: 'app-1',
          permissions: { canPublish: true, canPurchaseDomain: true },
        },
        socketId: 'sock-1',
      }

      beforeEach(() => {
        vi.mocked(executePublish).mockResolvedValue({ success: true, commitHash: 'abc1234' } as any)
        // Restore default after any per-test override; clearAllMocks resets call history
        // but NOT mockReturnValue implementations, so explicit reset is required.
        vi.mocked(validateDomainName).mockReturnValue({ valid: true })
        appRepoInstance.findById.mockReturnValue({ path: '/apps/app-1' })
        memoryInstance.readMemory.mockResolvedValue({ success: true, exists: false })
        memoryInstance.setMemory.mockResolvedValue({ success: true })
      })

      it('should fetch URL but skip domain logic when canPurchaseDomain is false', async () => {
        mockClientActionService.executeAction.mockResolvedValue({
          success: true,
          result: { publishedUrl: 'https://app-1.c4.airoapp.ai', domains: [] },
        })

        const context = {
          metadata: { appId: 'app-1', permissions: { canPublish: true, canPurchaseDomain: false } },
          socketId: 'sock-1',
        }

        const result = await runPublishTool({}, { experimental_context: context })

        // getSiteData is called for the URL even without domain permissions
        expect(mockClientActionService.executeAction).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'getSiteData' })
        )
        // But no domain-specific actions (attachDomain, etc.)
        expect(mockClientActionService.executeAction).not.toHaveBeenCalledWith(
          expect.objectContaining({ action: 'attachDomain' })
        )
        expect(result.publishedUrl).toBe('https://app-1.c4.airoapp.ai')
        expect(result.domainAttachEnabled).toBe(false)
        expect(result.shouldSuggestDomain).toBe(false)
      })

      it('should not suggest domain when site already has a custom domain', async () => {
        mockClientActionService.executeAction.mockResolvedValue({
          success: true,
          result: {
            publishedUrl: 'https://mysite.com',
            domains: [{ fqdn: 'mysite.com', domainType: 'custom', status: 'active' }],
          },
        })

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(result.shouldSuggestDomain).toBe(false)
        expect(result.publishedUrl).toBe('https://mysite.com')
        expect(result.message).toContain('publishedUrl: https://mysite.com')
        expect(result.message).not.toContain('[NEXT:')
      })

      it('should suggest "Add a custom domain" when no custom domain and no purchased domain', async () => {
        mockClientActionService.executeAction.mockResolvedValue({
          success: true,
          result: { domains: [] },
        })

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(result.shouldSuggestDomain).toBe(true)
        expect(result.message).toContain('Add a custom domain')
      })

      it('should suggest connecting purchased domain when purchased but not yet connected', async () => {
        mockClientActionService.executeAction.mockImplementation(async ({ action }: { action: string }) => {
          if (action === 'getSiteData') return { success: true, result: { domains: [] } }
          return { success: true }
        })
        memoryInstance.readMemory.mockResolvedValue({
          success: true, exists: true,
          value: { fqdn: 'bought.com', connectedToProject: false },
        })
        // Validation fails → auto-attach skipped, purchasedDomain remains set
        vi.mocked(validateDomainName).mockReturnValue({ valid: false, error: 'invalid for test' })

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(result.message).toContain('User bought bought.com')
        expect(result.message).toContain('Connect bought.com')
        expect(result.purchasedDomain).toBe('bought.com')
        expect(result.autoAttachedDomain).toBeUndefined()
      })

      it('should auto-attach validated purchased domain and update memory', async () => {
        // Three sequential calls: initial getSiteData → attachDomain → refetch getSiteData (canonical URL)
        mockClientActionService.executeAction
          .mockResolvedValueOnce({ success: true, result: { publishedUrl: 'https://app-1.c4.airoapp.ai', domains: [] } })
          .mockResolvedValueOnce({ success: true }) // attachDomain
          .mockResolvedValueOnce({ success: true, result: { publishedUrl: 'https://mysite.com', domains: [{ fqdn: 'mysite.com', domainType: 'custom', status: 'active' }] } }) // refetch
        memoryInstance.readMemory.mockResolvedValue({
          success: true, exists: true,
          value: { fqdn: 'mysite.com', connectedToProject: false },
        })

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(result.autoAttachedDomain).toBe('mysite.com')
        expect(result.shouldSuggestDomain).toBe(false)
        expect(result.message).toContain('Connected domain: mysite.com')
        // publishedUrl comes from the control plane refetch, not string construction
        expect(result.publishedUrl).toBe('https://mysite.com')
        expect(result.message).toContain('publishedUrl: https://mysite.com')
        expect(memoryInstance.setMemory).toHaveBeenCalledWith(
          expect.objectContaining({
            key: 'domain.purchased',
            value: expect.objectContaining({ fqdn: 'mysite.com', connectedToProject: true }),
          }),
          '/apps/app-1',
          'app-1',
          undefined
        )
      })

      it('should preserve pre-attach publishedUrl when canonical URL refetch fails', async () => {
        mockClientActionService.executeAction
          .mockResolvedValueOnce({ success: true, result: { publishedUrl: 'https://app-1.c4.airoapp.ai', domains: [] } })
          .mockResolvedValueOnce({ success: true }) // attachDomain
          .mockRejectedValueOnce(new Error('timeout')) // refetch fails
        memoryInstance.readMemory.mockResolvedValue({
          success: true, exists: true,
          value: { fqdn: 'mysite.com', connectedToProject: false },
        })

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(result.autoAttachedDomain).toBe('mysite.com')
        // Falls back to the initial getSiteData URL, not a string-constructed guess
        expect(result.publishedUrl).toBe('https://app-1.c4.airoapp.ai')
        expect(result.publishedUrl).not.toBe('https://mysite.com')
        expect(result.success).toBe(true)
      })

      it('should fall back to suggest when attachDomain returns success: false', async () => {
        mockClientActionService.executeAction.mockImplementation(async ({ action }: { action: string }) => {
          if (action === 'getSiteData') return { success: true, result: { domains: [] } }
          if (action === 'attachDomain') return { success: false, error: 'attach rejected' }
          return { success: false }
        })
        memoryInstance.readMemory.mockResolvedValue({
          success: true, exists: true,
          value: { fqdn: 'mysite.com', connectedToProject: false },
        })

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(result.autoAttachedDomain).toBeUndefined()
        expect(result.message).toContain('User bought mysite.com')
        expect(memoryInstance.setMemory).not.toHaveBeenCalled()
      })

      it('should fall back to suggest when attachDomain throws', async () => {
        mockClientActionService.executeAction.mockImplementation(async ({ action }: { action: string }) => {
          if (action === 'getSiteData') return { success: true, result: { domains: [] } }
          if (action === 'attachDomain') throw new Error('network error')
          return { success: false }
        })
        memoryInstance.readMemory.mockResolvedValue({
          success: true, exists: true,
          value: { fqdn: 'mysite.com', connectedToProject: false },
        })

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(result.autoAttachedDomain).toBeUndefined()
        expect(result.message).toContain('User bought mysite.com')
      })

      it('should succeed even when memory update after auto-attach throws', async () => {
        mockClientActionService.executeAction.mockImplementation(async ({ action }: { action: string }) => {
          if (action === 'getSiteData') return { success: true, result: { domains: [] } }
          if (action === 'attachDomain') return { success: true }
          return { success: false }
        })
        memoryInstance.readMemory.mockResolvedValue({
          success: true, exists: true,
          value: { fqdn: 'mysite.com', connectedToProject: false },
        })
        memoryInstance.setMemory.mockRejectedValue(new Error('disk full'))

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(result.success).toBe(true)
        expect(result.autoAttachedDomain).toBe('mysite.com')
      })

      it('should succeed gracefully when getSiteData throws', async () => {
        mockClientActionService.executeAction.mockRejectedValue(new Error('getSiteData failed'))

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(result.success).toBe(true)
        expect(result.shouldSuggestDomain).toBe(false)
        expect(result.message).not.toContain('[NEXT:')
      })

      it('should not auto-attach when app is not found in repo', async () => {
        mockClientActionService.executeAction.mockResolvedValue({
          success: true,
          result: { domains: [] },
        })
        appRepoInstance.findById.mockReturnValue(null)

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(memoryInstance.readMemory).not.toHaveBeenCalled()
        expect(result.autoAttachedDomain).toBeUndefined()
        expect(result.message).toContain('Add a custom domain')
      })

      it('should skip already-connected purchased domain', async () => {
        mockClientActionService.executeAction.mockResolvedValue({
          success: true,
          result: { domains: [] },
        })
        memoryInstance.readMemory.mockResolvedValue({
          success: true, exists: true,
          value: { fqdn: 'mysite.com', connectedToProject: true },
        })

        const result = await runPublishTool({}, { experimental_context: baseContext })

        expect(result.autoAttachedDomain).toBeUndefined()
        expect(result.purchasedDomain).toBeUndefined()
        expect(result.message).toContain('Add a custom domain')
      })
    })
  })

  describe('statusTool', () => {
    const mockSupervisor = {
      getPublishStatus: vi.fn(),
    }
    const mockStatusClientActionService = {
      executeAction: vi.fn(),
    }

    beforeEach(() => {
      vi.clearAllMocks()
      vi.mocked(DevSupervisorClientFactory.createForPublishSupervisor).mockReturnValue(
        mockSupervisor as any
      )
      vi.mocked(getClientActionService).mockReturnValue(mockStatusClientActionService as any)
    })

    it('throws when appId is missing', async () => {
      await expect(runStatusTool({}, { experimental_context: {} })).rejects.toThrow('App ID required')
      expect(DevSupervisorClientFactory.createForPublishSupervisor).not.toHaveBeenCalled()
    })

    it('returns guidance when publish supervisor is unavailable', async () => {
      vi.mocked(DevSupervisorClientFactory.createForPublishSupervisor).mockReturnValue(null as any)

      const out = await runStatusTool(
        {},
        { experimental_context: { metadata: { appId: 'app-1' } } }
      )

      expect(typeof out).toBe('string')
      expect(out).toContain('Publish supervisor unavailable')
      expect(out).toContain('may not be published')
    })

    it('calls getPublishStatus with defaults and formats response', async () => {
      mockSupervisor.getPublishStatus.mockResolvedValue({
        version: 'deadbeef1234567890',
        health: { status: 'healthy', message: 'ok' },
        process: { state: 'running', pid: 42, uptime: '1h' },
      })

      const out = await runStatusTool(
        {},
        { experimental_context: { metadata: { appId: 'app-1' } } }
      )

      expect(DevSupervisorClientFactory.createForPublishSupervisor).toHaveBeenCalledWith('app-1')
      expect(mockSupervisor.getPublishStatus).toHaveBeenCalledWith({
        lines: 200,
        includeLogs: true,
      })
      expect(out).toContain('deadbeef')
      expect(out).toContain('healthy')
      expect(out).toContain('running')
      expect(out).toContain('PID 42')
      expect(out).toContain('1h')
    })

    it('includes publishedUrl when available via getSiteData', async () => {
      mockStatusClientActionService.executeAction.mockResolvedValue({
        success: true,
        result: { publishedUrl: 'https://mysite.com' },
      })
      mockSupervisor.getPublishStatus.mockResolvedValue({
        version: 'abc1234',
        health: { status: 'healthy', message: 'ok' },
        process: { state: 'running', pid: 1, uptime: '5m' },
      })

      const out = await runStatusTool(
        {},
        { experimental_context: { metadata: { appId: 'app-1' }, socketId: 'sock-1' } }
      )

      expect(out).toContain('publishedUrl: https://mysite.com')
      expect(out).toContain('Version:')
    })

    it('works without publishedUrl when getSiteData fails', async () => {
      mockStatusClientActionService.executeAction.mockRejectedValue(new Error('timeout'))
      mockSupervisor.getPublishStatus.mockResolvedValue({
        version: 'abc1234',
        health: { status: 'healthy', message: 'ok' },
        process: { state: 'running', pid: 1, uptime: '5m' },
      })

      const out = await runStatusTool(
        {},
        { experimental_context: { metadata: { appId: 'app-1' }, socketId: 'sock-1' } }
      )

      expect(out).not.toContain('publishedUrl:')
      expect(out).toContain('Version:')
      expect(out).toContain('healthy')
    })

    it('forwards lines and includeLogs to getPublishStatus', async () => {
      mockSupervisor.getPublishStatus.mockResolvedValue({
        version: null,
        health: { status: 'unknown', message: '' },
        process: { state: 'stopped', pid: 0, uptime: '' },
      })

      await runStatusTool(
        { lines: 50, includeLogs: false },
        { experimental_context: { metadata: { appId: 'x' } } }
      )

      expect(mockSupervisor.getPublishStatus).toHaveBeenCalledWith({
        lines: 50,
        includeLogs: false,
      })
    })

    it('includes stderr and stdout log sections when present', async () => {
      mockSupervisor.getPublishStatus.mockResolvedValue({
        version: 'a',
        health: { status: 'healthy', message: '' },
        process: { state: 'running', pid: 1, uptime: '' },
        logs: [
          { source: 'stderr', message: 'err line' },
          { source: 'stdout', message: 'out line' },
        ],
      })

      const out = await runStatusTool(
        {},
        { experimental_context: { metadata: { appId: 'app-1' } } }
      )

      expect(out).toContain('stderr:')
      expect(out).toContain('err line')
      expect(out).toContain('stdout:')
      expect(out).toContain('out line')
    })

    it('appends unhealthy troubleshooting when health is unhealthy', async () => {
      mockSupervisor.getPublishStatus.mockResolvedValue({
        version: 'b',
        health: { status: 'unhealthy', message: 'bad' },
        process: { state: 'error', pid: 0, uptime: '' },
      })

      const out = await runStatusTool(
        {},
        { experimental_context: { metadata: { appId: 'app-1' } } }
      )

      expect(out).toContain('unhealthy')
      expect(out).toContain('npm run build')
    })

    it('wraps getPublishStatus errors', async () => {
      mockSupervisor.getPublishStatus.mockRejectedValue(new Error('network down'))

      await expect(
        runStatusTool({}, { experimental_context: { metadata: { appId: 'app-1' } } })
      ).rejects.toThrow('Failed to get publish status: network down')
    })
  })
})
