import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockSetMemory } = vi.hoisted(() => ({
    mockSetMemory: vi.fn().mockResolvedValue({ success: true }),
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

vi.mock('../../../../server/ai-lib-websocket-server.js', () => ({
    getClientActionService: vi.fn(),
}))

vi.mock('../../../../tools/memory-tool.js', () => ({
    MemoryTool: vi.fn().mockImplementation(() => ({
        setMemory: mockSetMemory,
    })),
}))

vi.mock('../../../../database/repositories/AppRepository.js', () => ({
    AppRepository: vi.fn().mockImplementation(() => ({
        findById: vi.fn().mockReturnValue({ path: '/fake/app/path' }),
    })),
}))

import { domainPurchaseTool } from '../index.js'
import { getClientActionService } from '../../../../server/ai-lib-websocket-server.js'

const mockGetClientActionService = vi.mocked(getClientActionService)

function execute(input: Record<string, unknown>, context: Record<string, unknown>) {
    return domainPurchaseTool.execute(input as any, context)
}

describe('custom-domain', function packageTests() {
    beforeEach(function reset() {
        vi.clearAllMocks()
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
            const mockExecuteAction = vi.fn().mockImplementation(({ action }) => {
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
            const mockExecuteAction = vi.fn().mockImplementation(({ action }) => {
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
            const mockExecuteAction = vi.fn().mockImplementation(({ action }) => {
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
            const mockExecuteAction = vi.fn().mockImplementation(({ action }) => {
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

        it('should store domain.purchased in memory when domain is provided', async function storeMemory() {
            const mockExecuteAction = vi.fn().mockImplementation(({ action }) => {
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

            await execute(
                { action: 'attach' },
                {
                    metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } },
                    socketId: 'socket-123'
                }
            )

            expect(mockSetMemory).not.toHaveBeenCalled()
        })

        it('should pass brandName to widget but not store it as a domain in memory', async function brandNameNotStored() {
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
            expect(result.widgetData.brandName).toBe('My Project')
            expect(result.message).toContain('existing.com')
            expect(mockSetMemory).not.toHaveBeenCalled()
        })

        it('should allow to proceed when publish status cannot be determined', async function failOpen() {
            let callCount = 0
            const mockExecuteAction = vi.fn().mockImplementation(() => {
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
            const mockExecuteAction = vi.fn().mockImplementation(({ action }) => {
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
