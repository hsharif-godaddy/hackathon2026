import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockSetMemory, mockEmitCustomEvent } = vi.hoisted(() => ({
    mockSetMemory: vi.fn().mockResolvedValue({ success: true }),
    mockEmitCustomEvent: vi.fn(),
}))

vi.mock('@godaddy/agent-otel-sdk', () => ({
    emitCustomEvent: mockEmitCustomEvent,
}))

vi.mock('../../../../logging/index.js', () => ({
    Logger: {
        create: vi.fn().mockReturnValue({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        })
    },
}))

vi.mock('../../../../server/agent-runtime.js', () => ({
    getActionService: vi.fn(),
}))

vi.mock('../../../../tools/memory-tool.js', () => ({
    MemoryTool: vi.fn().mockImplementation(function () { return {
        setMemory: mockSetMemory,
    }; }),
}))

vi.mock('../../../../database/repositories/AppRepository.js', () => ({
    AppRepository: vi.fn().mockImplementation(function () { return {
        findById: vi.fn().mockReturnValue({ path: '/fake/app/path' }),
    }; }),
}))

import { domainPurchaseTool } from '../index.js'
import { getActionService } from '../../../../server/agent-runtime.js'

const mockGetClientActionService = vi.mocked(getActionService)

function execute(input: Record<string, unknown>, context: Record<string, unknown>) {
    return domainPurchaseTool.execute(input as any, context)
}

describe('custom-domain', function packageTests() {
    beforeEach(function reset() {
        vi.clearAllMocks()
    })

    describe('#task OTel events', function taskEventTests() {
        function emitCallFor(schemaId: string): { conversationId?: string; eventData: { schemaId: string; data: Record<string, unknown> } } | undefined {
            const found = mockEmitCustomEvent.mock.calls.find((call) => call[0]?.eventData?.schemaId === schemaId)
            return found?.[0]
        }

        it('emits task-start then task-complete on a successful action', async function complete() {
            await execute(
                { action: 'purchase', brandName: 'Test Brand' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } } }
            )

            expect(emitCallFor('urn:shared:ai:event:/agent/domain/task-start/v1')).toBeTruthy()
            const complete = emitCallFor('urn:shared:ai:event:/agent/domain/task-complete/v1')
            expect(complete).toBeTruthy()
            expect(complete?.eventData.data.success).toBe(true)
            expect(complete?.eventData.data.action).toBe('purchase')
            expect(typeof complete?.eventData.data.durationMs).toBe('number')
            expect(emitCallFor('urn:shared:ai:event:/agent/domain/task-failed/v1')).toBeFalsy()
        })

        it('emits task-failed when the handler returns success:false', async function failed() {
            await execute(
                { action: 'purchase' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: false } } }
            )

            expect(emitCallFor('urn:shared:ai:event:/agent/domain/task-start/v1')).toBeTruthy()
            const taskFailed = emitCallFor('urn:shared:ai:event:/agent/domain/task-failed/v1')
            expect(taskFailed).toBeTruthy()
            expect(taskFailed?.eventData.data.success).toBe(false)
            expect(typeof taskFailed?.eventData.data.durationMs).toBe('number')
            expect(emitCallFor('urn:shared:ai:event:/agent/domain/task-complete/v1')).toBeFalsy()
        })

        it('does not emit task events when appId is missing (before task-start)', async function noAppId() {
            await execute({ action: 'purchase' }, { metadata: {} })
            expect(mockEmitCustomEvent).not.toHaveBeenCalled()
        })

        it('emits task-failed when the handler throws', async function handlerThrows() {
            mockGetClientActionService.mockImplementation(function () {
                throw new Error('service crashed')
            })

            await expect(execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123',
                }
            )).rejects.toThrow('service crashed')

            expect(emitCallFor('urn:shared:ai:event:/agent/domain/task-start/v1')).toBeTruthy()
            const taskFailed = emitCallFor('urn:shared:ai:event:/agent/domain/task-failed/v1')
            expect(taskFailed).toBeTruthy()
            expect(taskFailed?.eventData.data.success).toBe(false)
            expect(typeof taskFailed?.eventData.data.durationMs).toBe('number')
            expect(emitCallFor('urn:shared:ai:event:/agent/domain/task-complete/v1')).toBeFalsy()
        })
    })

    describe('#shared validation', function sharedTests() {
        it('should reject when appId is missing from context and input', async function missingAppId() {
            const result = await execute({ action: 'purchase' }, { metadata: {} })

            expect(result.success).toBe(false)
            expect(result.error).toBe('App ID is required')
        })

        it('should use appId from input when context metadata has none', async function inputAppId() {
            const result = await execute(
                { action: 'purchase', appId: 'app-from-input' },
                { metadata: { permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(true)
            expect(result.widgetData.appId).toBe('app-from-input')
        })
    })

    describe('#purchase action', function purchaseTests() {
        it('should reject when canPurchaseDomain is false', async function noPermission() {
            const result = await execute(
                { action: 'purchase' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: false } } }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Domain purchase permission not granted')
        })

        it('should reject when permissions object is missing entirely', async function missingPermissions() {
            const result = await execute(
                { action: 'purchase' },
                { metadata: { appId: 'app-123' } }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Domain purchase permission not granted')
        })

        it('should succeed when canPurchaseDomain is true', async function granted() {
            const result = await execute(
                { action: 'purchase', brandName: 'Test Brand' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(true)
            expect(result.widgetType).toBe('domain-purchase')
            expect(result.widgetData.type).toBe('domain-purchase')
        })

        it('should include brandName and appId in widget data', async function widgetData() {
            const result = await execute(
                { action: 'purchase', brandName: 'My Brand' },
                { metadata: { appId: 'app-456', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.widgetData).toEqual({
                type: 'domain-purchase',
                brandName: 'My Brand',
                domain: undefined,
                appId: 'app-456'
            })
        })

        it('should include domain in widget data when provided', async function domainWidgetData() {
            const result = await execute(
                { action: 'purchase', brandName: 'My Brand', domain: 'mybrand.com' },
                { metadata: { appId: 'app-456', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.widgetData).toEqual({
                type: 'domain-purchase',
                brandName: 'My Brand',
                domain: 'mybrand.com',
                appId: 'app-456'
            })
        })

        it('should handle missing brandName gracefully', async function noBrand() {
            const result = await execute(
                { action: 'purchase' },
                { metadata: { appId: 'app-456', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(true)
            expect(result.widgetData.brandName).toBeUndefined()
            expect(result.message).toBe('Domain purchase widget rendered')
        })

        it('should include domain in message when provided', async function messageWithDomain() {
            const result = await execute(
                { action: 'purchase', domain: 'libro-tacos.com' },
                { metadata: { appId: 'app-456', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.message).toBe('Domain purchase widget rendered for libro-tacos.com')
        })

        it('should include brandName in message when no domain provided', async function messageWithBrand() {
            const result = await execute(
                { action: 'purchase', brandName: 'Libro Tacos' },
                { metadata: { appId: 'app-456', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.message).toBe('Domain purchase widget rendered for Libro Tacos')
        })

        it('should reject invalid domain names', async function invalidDomain() {
            const result = await execute(
                { action: 'purchase', domain: 'not-a-domain' },
                { metadata: { appId: 'app-456', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(false)
            expect(result.message).toContain('"not-a-domain" is not a valid domain name')
        })

        it('should reject domain with single-char TLD', async function shortTld() {
            const result = await execute(
                { action: 'purchase', domain: 'example.a' },
                { metadata: { appId: 'app-456', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(false)
            expect(result.message).toContain('Top-level domain must be at least 2 characters')
        })

        it('should reject domain with invalid characters', async function invalidChars() {
            const result = await execute(
                { action: 'purchase', domain: 'my domain!.com' },
                { metadata: { appId: 'app-456', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(false)
            expect(result.message).toContain('invalid characters')
        })

        it('should reject domain exceeding max length', async function tooLong() {
            const longDomain = 'a'.repeat(250) + '.com'
            const result = await execute(
                { action: 'purchase', domain: longDomain },
                { metadata: { appId: 'app-456', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(false)
            expect(result.message).toContain('exceeds maximum length')
        })
    })

    describe('#attach action', function attachTests() {
        it('should reject when canPurchaseDomain is false', async function noPermission() {
            const result = await execute(
                { action: 'attach' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: false } } }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Domain purchase permission not granted')
        })

        it('should reject when socketId is missing', async function missingSocket() {
            const result = await execute(
                { action: 'attach' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Socket ID not available')
        })

        it('should reject when clientActionService is unavailable', async function noService() {
            mockGetClientActionService.mockReturnValue(undefined as any)

            const result = await execute(
                { action: 'attach' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Client action service unavailable')
        })

        it('should auto-attach domain when app is published and domain is provided', async function autoAttach() {
            const mockExecuteAction = vi.fn().mockImplementation(function ({ action }) {
                if (action === 'getSiteData') {
                    return Promise.resolve({ success: true, result: { variants: ['publish'], domains: [] } })
                }
                return Promise.resolve({ success: true })
            })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.widgetType).toBeUndefined()
            expect(result.message).toContain('mydomain.com')
            expect(mockExecuteAction).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'attachDomain', params: { appId: 'app-123', domainName: 'mydomain.com' } })
            )
        })

        it('should skip attachDomain when domain is already active on site', async function skipDuplicateAttach() {
            const mockExecuteAction = vi.fn().mockImplementation(function ({ action }) {
                if (action === 'getSiteData') {
                    return Promise.resolve({
                        success: true,
                        result: {
                            variants: ['publish'],
                            domains: [{ fqdn: 'mydomain.com', domainType: 'custom', status: 'active' }],
                        },
                    })
                }
                return Promise.resolve({ success: true })
            })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123',
                }
            )

            expect(result.success).toBe(true)
            expect(result.widgetType).toBeUndefined()
            expect(result.message).toContain('already on this app')
            expect(mockExecuteAction).toHaveBeenCalledTimes(1)
            expect(mockExecuteAction).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'getSiteData', params: { appId: 'app-123' } })
            )
            expect(mockSetMemory).not.toHaveBeenCalled()
        })

        it('should fall back to widget when auto-attach fails', async function autoAttachFallback() {
            const mockExecuteAction = vi.fn().mockImplementation(function ({ action }) {
                if (action === 'getSiteData') {
                    return Promise.resolve({ success: true, result: { variants: ['publish'] } })
                }
                return Promise.resolve({ success: false, error: 'Attach failed' })
            })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.widgetType).toBe('domain-attach')
            expect(result.widgetData.brandName).toBe('mydomain.com')
        })

        it('should fall back to widget when auto-attach throws', async function autoAttachError() {
            const mockExecuteAction = vi.fn().mockImplementation(function ({ action }) {
                if (action === 'getSiteData') {
                    return Promise.resolve({ success: true, result: { variants: ['publish'] } })
                }
                return Promise.reject(new Error('Network error'))
            })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.widgetType).toBe('domain-attach')
        })

        it('should return requiresPublish when app is not published', async function requiresPublish() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: { variants: [] }
                })
            } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(false)
            expect(result.requiresPublish).toBe(true)
            expect(result.error).toBe('App must be published before attaching a domain')
        })

        it('should tell agent to publish-then-auto-attach when domain is provided and app not published', async function requiresPublishWithDomainMessage() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: { variants: [] }
                })
            } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.requiresPublish).toBe(true)
            expect(result.message).toContain('mydomain.com')
            expect(result.message).toContain('automatically connected after publishing')
            expect(result.message).toContain('publish tool')
        })

        it('should tell agent to publish first when no domain provided and app not published', async function requiresPublishNoDomainMessage() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: { variants: [] }
                })
            } as any)

            const result = await execute(
                { action: 'attach' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.requiresPublish).toBe(true)
            expect(result.message).toContain('publish tool')
        })

        it('should store domain.purchased in memory when domain is provided', async function storeMemory() {
            const mockExecuteAction = vi.fn().mockImplementation(function ({ action }) {
                if (action === 'getSiteData') {
                    return Promise.resolve({ success: true, result: { variants: ['publish'] } })
                }
                return Promise.resolve({ success: true })
            })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(mockSetMemory).toHaveBeenCalledWith(
                expect.objectContaining({
                    key: 'domain.purchased',
                    value: expect.objectContaining({
                        fqdn: 'mydomain.com',
                        connectedToProject: false,
                    }),
                }),
                '/fake/app/path',
                'app-123',
                undefined
            )
        })

        it('should store domain in memory even when app is not published', async function storeMemoryUnpublished() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: { variants: [] }
                })
            } as any)

            await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(mockSetMemory).toHaveBeenCalledWith(
                expect.objectContaining({
                    key: 'domain.purchased',
                    value: expect.objectContaining({ fqdn: 'mydomain.com' }),
                }),
                '/fake/app/path',
                'app-123',
                undefined
            )
        })

        it('should not store memory when neither domain nor brandName is provided', async function skipMemory() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: { variants: ['publish'] }
                })
            } as any)

            const result = await execute(
                { action: 'attach' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.widgetType).toBe('domain-attach')
            expect(mockSetMemory).not.toHaveBeenCalled()
        })

        it('should show attach widget when only prefix domains are present', async function prefixOnlyShowsWidget() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {
                        variants: ['publish'],
                        domains: [{ fqdn: 'abc123.preview.example.com', domainType: 'prefix', status: 'active' }],
                    },
                })
            } as any)

            const result = await execute(
                { action: 'attach' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.widgetType).toBe('domain-attach')
            expect(result.alreadyConnected).toBeUndefined()
        })

        it('should confirm already-connected domain instead of showing widget', async function brandNameNotStored() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {
                        variants: ['publish'],
                        domains: [{ fqdn: 'existing.com', domainType: 'custom', status: 'active' }],
                    },
                })
            } as any)

            const result = await execute(
                { action: 'attach', brandName: 'My Project' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.alreadyConnected).toBe(true)
            expect(result.primaryDomain).toBe('existing.com')
            expect(result.widgetData).toBeUndefined()
            expect(result.message).toContain('existing.com')
            expect(mockSetMemory).not.toHaveBeenCalled()
        })

        it('should confirm provisioning domain without claiming it is fully connected', async function pendingDomainConfirm() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {
                        variants: ['publish'],
                        domains: [{ fqdn: 'provisioning.com', domainType: 'custom', status: 'pending' }],
                    },
                })
            } as any)

            const result = await execute(
                { action: 'attach' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.alreadyConnected).toBe(true)
            expect(result.primaryDomain).toBe('provisioning.com')
            expect(result.widgetData).toBeUndefined()
            expect(result.message).toContain('provisioning.com')
            expect(result.message).not.toContain('already connected')
        })

        it('should allow to proceed when publish status cannot be determined', async function failOpen() {
            let callCount = 0
            const mockExecuteAction = vi.fn().mockImplementation(function () {
                callCount++
                // First call is getSiteData — reject to trigger fail-open
                if (callCount === 1) return Promise.reject(new Error('timeout'))
                // Second call is attachDomain — succeed
                return Promise.resolve({ success: true })
            })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.message).toContain('mydomain.com')
        })

        it('should allow to proceed when getSiteData returns success: false', async function siteDataFailed() {
            const mockExecuteAction = vi.fn().mockImplementation(function ({ action }) {
                if (action === 'getSiteData') {
                    return Promise.resolve({ success: false, error: 'Site not found' })
                }
                return Promise.resolve({ success: true })
            })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.message).toContain('mydomain.com')
        })

        it('should allow to proceed when getSiteData result has no variants field', async function noVariants() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {}
                })
            } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(false)
            expect(result.requiresPublish).toBe(true)
        })

        it('should reject non-string socketId', async function nonStringSocket() {
            const result = await execute(
                { action: 'attach' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 123
                }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Socket ID not available')
        })
    })

    describe('#attach action — cross-account ownership', function ownershipTests() {
        type OwnershipMock = Record<string, unknown> | 'throw' | 'fail' | 'noresult'
        function mockActions(ownership: OwnershipMock, opts: { published?: boolean; domains?: unknown[] } = {}) {
            const published = opts.published ?? true
            const siteDomains = opts.domains ?? []
            return vi.fn().mockImplementation(function ({ action }: { action: string }) {
                if (action === 'getSiteData') {
                    return Promise.resolve({ success: true, result: { variants: published ? ['publish'] : [], domains: siteDomains } })
                }
                if (action === 'checkDomainOwnership') {
                    if (ownership === 'throw') return Promise.reject(new Error('ownership timeout'))
                    if (ownership === 'fail') return Promise.resolve({ success: false, error: 'lookup failed' })
                    if (ownership === 'noresult') return Promise.resolve({ success: true })
                    return Promise.resolve({ success: true, result: ownership })
                }
                return Promise.resolve({ success: true }) // attachDomain
            })
        }

        it('should block a domain owned by a different GoDaddy account', async function crossAccountBlocks() {
            const mockExecuteAction = mockActions({ isGdDomain: true, isGDDomainOwner: false, isGoDaddyDns: true })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'foreign.com' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } }, socketId: 'socket-123' }
            )

            expect(result.success).toBe(false)
            expect(result.crossAccount).toBe(true)
            expect(result.message).toContain('different GoDaddy account')
            expect(mockExecuteAction).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'attachDomain' }))
            expect(mockSetMemory).not.toHaveBeenCalled()
        })

        it('should block a cross-account domain even when unpublished (no store, no publish promise)', async function crossAccountUnpublished() {
            const mockExecuteAction = mockActions({ isGdDomain: true, isGDDomainOwner: false }, { published: false })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'foreign.com' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } }, socketId: 'socket-123' }
            )

            expect(result.success).toBe(false)
            expect(result.crossAccount).toBe(true)
            expect(result.requiresPublish).toBeUndefined()
            expect(mockSetMemory).not.toHaveBeenCalled()
            expect(mockExecuteAction).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'attachDomain' }))
        })

        it('should proceed to attach for a domain owned by this account', async function ownedProceeds() {
            const mockExecuteAction = mockActions({ isGdDomain: true, isGDDomainOwner: true })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mine.com' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } }, socketId: 'socket-123' }
            )

            expect(result.success).toBe(true)
            expect(result.crossAccount).toBeUndefined()
            expect(result.widgetType).toBeUndefined()
            expect(mockExecuteAction).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'attachDomain', params: { appId: 'app-123', domainName: 'mine.com' } })
            )
            expect(result.message).toContain('GoDaddy is configuring')
        })

        it('should proceed to attach for an external (non-GoDaddy) domain', async function externalProceeds() {
            const mockExecuteAction = mockActions({ isGdDomain: false, isGDDomainOwner: false })
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'external.io' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } }, socketId: 'socket-123' }
            )

            expect(result.success).toBe(true)
            expect(result.crossAccount).toBeUndefined()
            expect(mockExecuteAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'attachDomain' }))
            expect(result.message).toContain('registered outside GoDaddy')
        })

        it('should fail open and attach when the ownership check throws', async function failOpenThrow() {
            const mockExecuteAction = mockActions('throw')
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } }, socketId: 'socket-123' }
            )

            expect(result.success).toBe(true)
            expect(result.crossAccount).toBeUndefined()
            expect(mockExecuteAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'attachDomain' }))
        })

        it('should fail open and attach when the ownership check returns success:false', async function failOpenFalse() {
            const mockExecuteAction = mockActions('fail')
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } }, socketId: 'socket-123' }
            )

            expect(result.success).toBe(true)
            expect(mockExecuteAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'attachDomain' }))
        })

        it('should fail open and attach when the ownership check succeeds with no result payload', async function failOpenNoResult() {
            const mockExecuteAction = mockActions('noresult')
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mydomain.com' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } }, socketId: 'socket-123' }
            )

            expect(result.success).toBe(true)
            expect(result.crossAccount).toBeUndefined()
            expect(mockExecuteAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'attachDomain' }))
        })

        it('should skip the ownership check when the domain is already on the app', async function skipWhenAlreadyOnApp() {
            const mockExecuteAction = mockActions(
                { isGdDomain: true, isGDDomainOwner: false },
                { domains: [{ fqdn: 'mine.com', domainType: 'custom', status: 'active' }] }
            )
            mockGetClientActionService.mockReturnValue({ executeAction: mockExecuteAction } as any)

            const result = await execute(
                { action: 'attach', domain: 'mine.com' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } }, socketId: 'socket-123' }
            )

            expect(result.success).toBe(true)
            expect(result.message).toContain('already on this app')
            expect(mockExecuteAction).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'checkDomainOwnership' }))
        })
    })

    describe('#computeState', function computeStateTests() {
        const computeState = (domainPurchaseTool as any).computeState

        it('should record a started attach as provisioning, not active', function provisioning() {
            const state = computeState({ action: 'attach', domain: 'mydomain.com' }, { success: true })
            expect(state).toEqual({ connectedDomain: 'mydomain.com', status: 'provisioning' })
        })

        it('should not record state for a cross-account (blocked) result', function crossAccountNoState() {
            const state = computeState({ action: 'attach', domain: 'foreign.com' }, { success: false, crossAccount: true })
            expect(state).toBeNull()
        })

        it('should not record state for a widget fallback', function widgetNoState() {
            const state = computeState({ action: 'attach', domain: 'x.com' }, { success: true, widgetType: 'domain-attach' })
            expect(state).toBeNull()
        })

        it('should not record state for a requires-publish result', function requiresPublishNoState() {
            const state = computeState({ action: 'attach', domain: 'x.com' }, { success: true, requiresPublish: true })
            expect(state).toBeNull()
        })

        it('should not record state for an already-connected result', function alreadyConnectedNoState() {
            const state = computeState({ action: 'attach', domain: 'x.com' }, { success: true, alreadyConnected: true })
            expect(state).toBeNull()
        })
    })

    describe('#forward action', function forwardTests() {
        it('should not be blocked by canPurchaseDomain: false', async function permissionBypass() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {
                        variants: ['publish'],
                        domains: [{ fqdn: 'primary.com', domainType: 'custom', status: 'active' }],
                    },
                })
            } as any)

            const result = await execute(
                { action: 'forward' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: false } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.forwardingInstructions.primaryDomain).toBe('primary.com')
        })

        it('should reject when socketId is missing', async function missingSocket() {
            const result = await execute(
                { action: 'forward' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Socket ID not available')
        })

        it('should reject when clientActionService is unavailable', async function noService() {
            mockGetClientActionService.mockReturnValue(undefined as any)

            const result = await execute(
                { action: 'forward' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Client action service unavailable')
        })

        it('should return neutral error when site context fetch fails', async function siteContextFailed() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockRejectedValue(new Error('timeout'))
            } as any)

            const result = await execute(
                { action: 'forward' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Unable to check connected domains')
            expect(result.message).toContain('try again')
        })

        it('should reject invalid domain names', async function invalidDomain() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: { variants: ['publish'], domains: [] },
                })
            } as any)

            const result = await execute(
                { action: 'forward', domain: 'not-a-domain' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(false)
            expect(result.message).toContain('"not-a-domain" is not a valid domain name')
        })

        it('should return forwarding instructions with DCC link when domain is provided', async function withDomain() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {
                        variants: ['publish'],
                        domains: [{ fqdn: 'primary.com', domainType: 'custom', status: 'active' }],
                    },
                })
            } as any)

            const result = await execute(
                { action: 'forward', domain: 'secondary.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.forwardingInstructions.dccLink).toBe('https://dcc.godaddy.com/control/portfolio/secondary.com/settings?tab=forwarding')
            expect(result.forwardingInstructions.sourceDomain).toBe('secondary.com')
            expect(result.forwardingInstructions.primaryDomain).toBe('primary.com')
            expect(result.message).toContain('secondary.com')
            expect(result.message).toContain('primary.com')
            expect(result.message).toContain('if secondary.com is a GoDaddy domain')
            expect(result.message).toContain('registered elsewhere')
        })

        it('should match status case-insensitively', async function caseInsensitiveStatus() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {
                        variants: ['publish'],
                        domains: [{ fqdn: 'primary.com', domainType: 'custom', status: 'Active' }],
                    },
                })
            } as any)

            const result = await execute(
                { action: 'forward' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.forwardingInstructions.primaryDomain).toBe('primary.com')
        })

        it('should return forwarding instructions without DCC link when no domain provided', async function withoutDomain() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {
                        variants: ['publish'],
                        domains: [{ fqdn: 'primary.com', domainType: 'custom', status: 'active' }],
                    },
                })
            } as any)

            const result = await execute(
                { action: 'forward' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(true)
            expect(result.forwardingInstructions.dccLink).toBeUndefined()
            expect(result.forwardingInstructions.sourceDomain).toBeUndefined()
            expect(result.forwardingInstructions.primaryDomain).toBe('primary.com')
            expect(result.message).toContain('primary.com')
        })

        it('should include primary domain from site context when available', async function primaryFromSite() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {
                        variants: ['publish'],
                        domains: [
                            { fqdn: 'prefix.airoapp.ai', domainType: 'prefix', status: 'active' },
                            { fqdn: 'mysite.com', domainType: 'custom', status: 'active' },
                        ],
                    },
                })
            } as any)

            const result = await execute(
                { action: 'forward', domain: 'other.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.forwardingInstructions.primaryDomain).toBe('mysite.com')
        })

        it('should return success false when no primary domain is attached', async function noPrimaryDomain() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {
                        variants: ['publish'],
                        domains: [],
                    },
                })
            } as any)

            const result = await execute(
                { action: 'forward', domain: 'secondary.com' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('No primary domain attached')
            expect(result.forwardingInstructions.primaryDomain).toBeUndefined()
            expect(result.forwardingInstructions.dccLink).toBeUndefined()
            expect(result.message).toContain('Attach a primary domain first')
        })

        it('should always include help article link', async function helpArticle() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: { variants: ['publish'], domains: [] },
                })
            } as any)

            const result = await execute(
                { action: 'forward' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.forwardingInstructions.helpArticle).toBe('https://www.godaddy.com/help/forward-my-godaddy-domain-12123')
        })

        it('should skip prefix domains when finding primary', async function skipPrefix() {
            mockGetClientActionService.mockReturnValue({
                executeAction: vi.fn().mockResolvedValue({
                    success: true,
                    result: {
                        variants: ['publish'],
                        domains: [
                            { fqdn: 'abc123.preview.airoapp.ai', domainType: 'prefix', status: 'active' },
                        ],
                    },
                })
            } as any)

            const result = await execute(
                { action: 'forward' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(result.success).toBe(false)
            expect(result.forwardingInstructions.primaryDomain).toBeUndefined()
            expect(result.message).toContain('Attach a primary domain first')
        })
    })
})
