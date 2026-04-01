import { createTool, type Tool } from '@airo/ai-lib'
import { fqdnIsConnectedOrProvisioningOnSite, type SiteDomainForAttachCheck } from '@airo/shared'
import { z } from 'zod'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { Logger } from '../../logging/index.js'
import { getClientActionService } from '../../server/ai-lib-websocket-server.js'
import { validateDomainName } from '../../utils/domain-validation.js'
import { MemoryTool } from '../memory-tool.js'

const logger = Logger.create({ component: 'domain-tool' })
const memoryTool = new MemoryTool()
const appRepo = new AppRepository()

const domainInputSchema = z.object({
    action: z.enum(['purchase', 'attach']).describe(
        'Action to perform. "purchase" = user wants to BUY/FIND a new domain. "attach" = user wants to CONNECT a domain they already own.'
    ),
    brandName: z.string().optional().describe(
        'Human-readable business/project name for domain search suggestions. NOT a domain — no dots or TLDs. Examples: "Sweet Delights Bakery", "Libro Tacos". Omit if user specified an exact domain and no brand context.'
    ),
    domain: z.string().optional().describe(
        'Exact fully-qualified domain name, including TLD. Examples: "my-sweet-store.com", "libro-tacos.net". For purchase: the domain user wants to buy. For attach: the domain user wants to connect. Only set when user explicitly states a domain name with a TLD. Never fabricate — leave empty if user only describes a brand.'
    ),
    appId: z.string().optional().describe(
        'The app ID for context (optional, uses current session app if not provided)'
    )
})

/**
 * @example
 * domain({ action: 'purchase', brandName: 'Letter Club' })
 * domain({ action: 'purchase', domain: 'letter-club.com' })
 * domain({ action: 'attach', domain: 'mydomain.com' })
 */
export const domainPurchaseAITool: Tool = createTool(
    `MANDATORY: ALWAYS call this tool when the user mentions domains. Never substitute calling this tool with a standalone prose reply about domains — call the tool first, then answer from its result.
Even if this tool was already called earlier in the conversation, CALL IT AGAIN. Every request gets a fresh tool call.

Unified domain tool for purchasing new domains or attaching existing ones to a project.

ACTION = "purchase" — Show the domain PURCHASE widget to help users SEARCH FOR and BUY a NEW domain.
ACTION = "attach"  — Show the domain ATTACH widget to help users CONNECT an existing domain.

WHEN TO USE action="purchase" (BUY/FIND):
- User says "buy a domain", "purchase a domain", "get a domain", "find a domain"
- User says "I need a domain", "search for domains"
- User wants to see available domains, suggestions, or pricing
- User doesn't have a domain yet

WHEN TO USE action="attach" (CONNECT/LINK):
- User says "I purchased <domain>!", "I bought <domain>!"
- User says "Attach <domain>", "Use <domain>", "Connect <domain>"
- User says "add my domain to my site", "link my domain"
- User already owns a domain and wants to point it to their app
- After publish when user asks about domain connection

PUBLISH HANDLING (attach only):
- If app is NOT published → Tool returns requiresPublish flag. Ask the user if they want to publish first.
- If app IS published → Shows widget immediately

Pass domain when user specifies an exact domain (e.g. "I want to buy my-sweet-store.com").
Pass brandName as the project/app name for general domain suggestions.

The tool result message may list domains already on the app (from live site data). If it says a domain is already connected, reflect that to the user from the tool message — do not imply they must attach again.

CRITICAL RULES:
1. ALWAYS call this tool — even if it was called before in this conversation. The widget must be re-rendered every time.
2. After the tool returns, you may briefly paraphrase its result for the user (e.g. requiresPublish, domain already on the app, widget shown). Do not call the tool again solely to repeat the same status you already stated in your last reply.
3. NEVER say "scroll up" or "I already showed the widget" — call the tool again.
4. If user mentions a SPECIFIC DOMAIN, pass it as domain param.
5. NEVER redirect to Settings — use this tool instead.
6. NEVER ask clarifying questions — just show the widget.`,
    domainInputSchema,
    async (input, context) => {
        const appId = context?.metadata?.appId as string || input.appId
        if (!appId) {
            logger.error('domain.missing-app-id', {})
            return {
                success: false,
                error: 'App ID is required',
                message: 'App ID is required for domain operations. Please ensure you are working within an app context.'
            }
        }

        return input.action === 'purchase'
            ? purchase(input, context, appId)
            : attach(input, context, appId)
    }
)

async function purchase(
    input: z.infer<typeof domainInputSchema>,
    context: any,
    appId: string
) {
    const permissions = context?.metadata?.permissions ?? {}
    const canPurchaseDomain = permissions?.canPurchaseDomain ?? false

    logger.info('domain.purchase.permission-check', {
        canPurchaseDomain,
        permissionsHasPurchaseDomain: Object.hasOwn(permissions, 'canPurchaseDomain'),
    })

    if (!canPurchaseDomain) {
        logger.warn('domain.purchase.no-permission', {
            message: 'User does not have domain purchase permission',
        })
        return {
            success: false,
            error: 'Domain purchase permission not granted',
            message: 'This feature is not enabled for your account.'
        }
    }

    const domain = input.domain?.trim() || undefined

    if (domain) {
        const validation = validateDomainName(domain)
        if (!validation.valid) {
            logger.warn('domain.purchase.invalid-domain', {
                domain,
                error: validation.error,
            })
            return {
                success: false,
                error: validation.error,
                message: `"${domain}" is not a valid domain name. ${validation.error}`
            }
        }
    }

    logger.info('domain.purchase.render', {
        brandName: input.brandName || 'not-provided',
        domain: domain || 'not-provided',
        appId
    })

    return {
        success: true,
        widgetType: 'domain-purchase',
        widgetData: {
            type: 'domain-purchase',
            brandName: input.brandName,
            domain,
            appId
        },
        message: `Domain purchase widget rendered${(domain || input.brandName) ? ` for ${domain || input.brandName}` : ''}`
    }
}

async function attach(
    input: z.infer<typeof domainInputSchema>,
    context: any,
    appId: string
) {
    const permissions = context?.metadata?.permissions ?? {}
    const canPurchaseDomain = permissions?.canPurchaseDomain ?? false

    logger.info('domain.attach.permission-check', {
        canPurchaseDomain,
        permissionsHasPurchaseDomain: Object.hasOwn(permissions, 'canPurchaseDomain'),
    })

    if (!canPurchaseDomain) {
        logger.warn('domain.attach.no-permission', {
            message: 'User does not have domain purchase permission',
        })
        return {
            success: false,
            error: 'Domain purchase permission not granted',
            message: 'This feature is not enabled for your account.'
        }
    }

    const socketId = context?.socketId
    if (!socketId || typeof socketId !== 'string') {
        logger.error('domain.attach.missing-socket-id', { appId })
        return {
            success: false,
            error: 'Socket ID not available',
            message: 'Unable to verify app status. Please try again.'
        }
    }

    const clientActionService = getClientActionService(socketId)
    if (!clientActionService) {
        logger.error('domain.attach.client-action-service-unavailable', { appId })
        return {
            success: false,
            error: 'Client action service not available',
            message: 'Unable to verify app status. Please try again.'
        }
    }

    const domain = input.domain?.trim() || undefined

    const { published, domains: siteDomains } = await getSiteContextForAttach(clientActionService, appId)
    if (!published) {
        if (domain) {
            await storePurchasedDomain(appId, domain)
        }
        logger.info('domain.attach.requires-publish', {
            appId,
            domain: domain || 'not-provided',
        })
        return {
            success: false,
            requiresPublish: true,
            error: 'App must be published before attaching a domain',
            message: 'The app needs to be published before a domain can be attached. Ask the user if they would like to publish first.'
        }
    }

    if (domain) {
        if (fqdnIsConnectedOrProvisioningOnSite(siteDomains, domain)) {
            logger.info('domain.attach.skip-already-on-app', { appId, domain })
            return {
                success: true,
                message: `Domain ${domain} is already on this app (active or still provisioning). Confirm with the user — no attach step needed.`
            }
        }
        await storePurchasedDomain(appId, domain)
        return autoAttach(clientActionService, appId, domain)
    }

    logger.info('domain.attach.render', {
        domain: 'not-provided',
        appId,
    })

    const attachedSummary = formatSiteCustomDomainsSummary(siteDomains)

    return {
        success: true,
        widgetType: 'domain-attach',
        widgetData: {
            type: 'domain-attach',
            brandName: domain || input.brandName,
            appId
        },
        message: attachedSummary
            ? `Domain attach widget rendered. Custom domains already on this app: ${attachedSummary}.`
            : 'Domain attach widget rendered'
    }
}

/**
 * Auto-attach a domain to a published app via the client action service.
 * Falls back to the widget when the client-side action fails.
 */
async function autoAttach(
    clientActionService: NonNullable<ReturnType<typeof getClientActionService>>,
    appId: string,
    domain: string
) {
    try {
        logger.info('domain.attach.auto', { appId, domain })

        const result = await clientActionService.executeAction({
            action: 'attachDomain',
            params: { appId, domainName: domain },
            timeoutMs: 15000,
        })

        if (result.success) {
            logger.info('domain.attach.auto.success', { appId, domain })
            return {
                success: true,
                message: `Domain ${domain} has been attached to your app. DNS propagation may take a few minutes.`
            }
        }

        logger.warn('domain.attach.auto.failed', {
            appId,
            domain,
            error: (result as any).error,
        })
    } catch (error) {
        logger.warn('domain.attach.auto.error', {
            appId,
            domain,
            error: error instanceof Error ? error.message : String(error),
        })
    }

    // Fall back to widget so the user can retry manually
    return {
        success: true,
        widgetType: 'domain-attach',
        widgetData: {
            type: 'domain-attach',
            brandName: domain,
            appId
        },
        message: `Automatic attachment failed — showing domain attach widget for ${domain}`
    }
}

function formatSiteCustomDomainsSummary(domains: SiteDomainForAttachCheck[] | undefined): string {
    if (!domains?.length) return ''
    const rows = domains.filter((d) => d.domainType !== 'prefix')
    if (!rows.length) return ''
    return rows.map((d) => `${d.fqdn} (${d.status ?? 'unknown'})`).join('; ')
}

/**
 * Published flag and domain list from the browser site store (getSiteData).
 * If the call fails, published defaults true (fail open) to match prior checkPublished behavior.
 */
async function getSiteContextForAttach(
    clientActionService: NonNullable<ReturnType<typeof getClientActionService>>,
    appId: string
): Promise<{ published: boolean; domains?: SiteDomainForAttachCheck[] }> {
    try {
        const siteDataResult = await clientActionService.executeAction({
            action: 'getSiteData',
            params: { appId },
            timeoutMs: 10000,
        })

        if (siteDataResult.success && siteDataResult.result) {
            const siteData = siteDataResult.result as { variants?: string[]; domains?: SiteDomainForAttachCheck[] }
            return {
                published: siteData.variants?.includes('publish') ?? false,
                domains: siteData.domains,
            }
        }
    } catch (error) {
        logger.warn('domain.attach.site-context-failed', {
            appId,
            error: error instanceof Error ? error.message : String(error),
        })
    }

    return { published: true }
}

/**
 * Best-effort store of domain.purchased in memory.
 * The publish tool reads this key to auto-attach purchased domains.
 * Failures are logged but never block the attach widget from rendering.
 */
async function storePurchasedDomain(appId: string, fqdn: string) {
    try {
        const app = appRepo.findById(appId)
        if (!app) return

        await memoryTool.setMemory(
            {
                key: 'domain.purchased',
                value: {
                    fqdn,
                    connectedToProject: false,
                    purchasedAt: new Date().toISOString(),
                },
            },
            app.path,
            appId
        )
        logger.info('domain.attach.memory-stored', { appId, fqdn })
    } catch (error) {
        logger.warn('domain.attach.memory-store-failed', {
            appId,
            fqdn,
            error: error instanceof Error ? error.message : String(error),
        })
    }
}
