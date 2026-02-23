import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../logging/index.js', () => ({
    Logger: {
        create: vi.fn().mockReturnValue({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        })
    },
}))

import { domainPurchaseAITool } from '../domain-purchase.js'

function execute(input: Record<string, unknown>, context: Record<string, unknown>) {
    return (domainPurchaseAITool as any).execute(input, { experimental_context: context })
}

describe('domain-purchase', function packageTests() {
    beforeEach(function reset() {
        vi.clearAllMocks()
    })

    describe('#permission checks', function permissionTests() {
        it('should reject when appId is missing from context and input', async function missingAppId() {
            const result = await execute({}, { metadata: {} })

            expect(result.success).toBe(false)
            expect(result.error).toBe('App ID is required')
        })

        it('should use appId from input when context metadata has none', async function inputAppId() {
            const result = await execute(
                { appId: 'app-from-input' },
                { metadata: { permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(true)
            expect(result.widgetData.appId).toBe('app-from-input')
        })

        it('should reject when canPurchaseDomain is false', async function noPermission() {
            const result = await execute(
                {},
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: false } } }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Domain purchase permission not granted')
        })

        it('should reject when permissions object is missing entirely', async function missingPermissions() {
            const result = await execute(
                {},
                { metadata: { appId: 'app-123' } }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBe('Domain purchase permission not granted')
        })

        it('should succeed when canPurchaseDomain is true', async function granted() {
            const result = await execute(
                { brandName: 'Test Brand' },
                { metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.success).toBe(true)
        })
    })

    describe('#domain validation', function validationTests() {
        const permittedContext = {
            metadata: { appId: 'app-123', permissions: { canPurchaseDomain: true } }
        }

        it('should reject invalid domain param', async function invalidDomain() {
            const result = await execute(
                { domain: '-invalid.com' },
                permittedContext
            )

            expect(result.success).toBe(false)
            expect(result.message).toContain('-invalid.com')
            expect(result.message).toContain('not a valid domain name')
        })

        it('should accept valid domain param', async function validDomain() {
            const result = await execute(
                { domain: 'my-sweet-store.com' },
                permittedContext
            )

            expect(result.success).toBe(true)
            expect(result.widgetData.domain).toBe('my-sweet-store.com')
        })

        it('should not validate brandName as a domain', async function brandNotValidated() {
            const result = await execute(
                { brandName: 'Sweet Delights Bakery' },
                permittedContext
            )

            expect(result.success).toBe(true)
            expect(result.widgetData.brandName).toBe('Sweet Delights Bakery')
        })

        it('should pass both brandName and domain to widget data', async function bothParams() {
            const result = await execute(
                { brandName: 'Sweet Delights', domain: 'sweet-delights.com' },
                permittedContext
            )

            expect(result.success).toBe(true)
            expect(result.widgetData.brandName).toBe('Sweet Delights')
            expect(result.widgetData.domain).toBe('sweet-delights.com')
        })
    })

    describe('#widget data structure', function widgetTests() {
        const permittedContext = {
            metadata: { appId: 'app-456', permissions: { canPurchaseDomain: true } }
        }

        it('should return domain-purchase widget type', async function widgetType() {
            const result = await execute({ brandName: 'Test' }, permittedContext)

            expect(result.widgetType).toBe('domain-purchase')
            expect(result.widgetData.type).toBe('domain-purchase')
        })

        it('should include brandName and appId in widget data', async function widgetData() {
            const result = await execute({ brandName: 'My Brand' }, permittedContext)

            expect(result.widgetData).toEqual({
                type: 'domain-purchase',
                brandName: 'My Brand',
                domain: undefined,
                appId: 'app-456'
            })
        })

        it('should handle missing brandName and domain gracefully', async function noBrandOrDomain() {
            const result = await execute({}, permittedContext)

            expect(result.success).toBe(true)
            expect(result.widgetData.brandName).toBeUndefined()
            expect(result.widgetData.domain).toBeUndefined()
            expect(result.widgetData.appId).toBe('app-456')
            expect(result.message).toBe('Domain purchase widget rendered')
        })

        it('should use domain in message when provided', async function messageWithDomain() {
            const result = await execute({ domain: 'libro-tacos.com' }, permittedContext)

            expect(result.message).toBe('Domain purchase widget rendered for libro-tacos.com')
        })

        it('should use brandName in message when no domain', async function messageWithBrand() {
            const result = await execute({ brandName: 'Libro Tacos' }, permittedContext)

            expect(result.message).toBe('Domain purchase widget rendered for Libro Tacos')
        })

        it('should prefer domain over brandName in message', async function messagePrefDomain() {
            const result = await execute(
                { brandName: 'Libro Tacos', domain: 'libro-tacos.com' },
                permittedContext
            )

            expect(result.message).toBe('Domain purchase widget rendered for libro-tacos.com')
        })

        it('should prefer context appId over input appId', async function contextAppId() {
            const result = await execute(
                { appId: 'input-app' },
                { metadata: { appId: 'context-app', permissions: { canPurchaseDomain: true } } }
            )

            expect(result.widgetData.appId).toBe('context-app')
        })
    })

    describe('#schema usage scenarios', function scenarioTests() {
        const permittedContext = {
            metadata: { appId: 'app-789', permissions: { canPurchaseDomain: true } }
        }

        it('should handle "I want to buy my-sweet-store.com" (explicit domain)', async function explicitDomain() {
            const result = await execute(
                { domain: 'my-sweet-store.com' },
                permittedContext
            )

            expect(result.success).toBe(true)
            expect(result.widgetData.domain).toBe('my-sweet-store.com')
            expect(result.widgetData.brandName).toBeUndefined()
        })

        it('should handle "help me find a domain for my bakery" (brand only)', async function brandOnly() {
            const result = await execute(
                { brandName: 'Sweet Delights Bakery' },
                permittedContext
            )

            expect(result.success).toBe(true)
            expect(result.widgetData.brandName).toBe('Sweet Delights Bakery')
            expect(result.widgetData.domain).toBeUndefined()
        })

        it('should handle "buy sweet-delights.com for my bakery" (both)', async function bothProvided() {
            const result = await execute(
                { brandName: 'Sweet Delights Bakery', domain: 'sweet-delights.com' },
                permittedContext
            )

            expect(result.success).toBe(true)
            expect(result.widgetData.brandName).toBe('Sweet Delights Bakery')
            expect(result.widgetData.domain).toBe('sweet-delights.com')
        })

        it('should handle "I need a custom domain" (no specifics)', async function noSpecifics() {
            const result = await execute({}, permittedContext)

            expect(result.success).toBe(true)
            expect(result.widgetData.brandName).toBeUndefined()
            expect(result.widgetData.domain).toBeUndefined()
        })

        it('should reject malformed domain while keeping brandName flexible', async function malformedDomain() {
            const result = await execute(
                { brandName: 'My Cool App!!!', domain: '-bad-.com' },
                permittedContext
            )

            expect(result.success).toBe(false)
            expect(result.message).toContain('not a valid domain name')
        })

        it('should trim whitespace from domain before validation and storage', async function whitespace() {
            const result = await execute(
                { domain: '  sweet-delights.com  ' },
                permittedContext
            )

            expect(result.success).toBe(true)
            expect(result.widgetData.domain).toBe('sweet-delights.com')
        })
    })
})
