import { fqdnIsConnectedOrProvisioningOnSite, getConnectedOrProvisioningDomain, type SiteDomainForAttachCheck } from '@airo/shared'
import { z } from 'zod'

import type { SkillToolDefinition } from '@airo/ai-skills'

import { readAppFqdn } from '../../../lib/app-fqdn.js'
import { AppRepository } from '../../../database/repositories/AppRepository.js'
import { MemoryRepository } from '../../../database/repositories/MemoryRepository.js'
import { Logger } from '../../../logging/index.js'
import { customerIdFromContext } from '../../../memory/interfaces/scope.js'
import { getActionService } from '../../../server/agent-runtime.js'
import { MemoryTool } from '../../../tools/memory-tool.js'
import { validateDomainName } from '../../../utils/domain-validation.js'

const logger = Logger.create({ component: 'domain-tool' })
const memoryTool = new MemoryTool()
const appRepo = new AppRepository()
const memoryRepo = new MemoryRepository()

const DOMAIN_ATTACH_AGENT_EXPLAINER =
    'Connecting points the domain at this app. GoDaddy domains: DNS auto-updated. External: user updates DNS at registrar. If domain serves another site, attaching moves traffic here—confirm with user first.'

function messageForAttachWidget(base: string): string {
    return `${base.trimEnd()}\n\n${DOMAIN_ATTACH_AGENT_EXPLAINER}`
}

const DOMAIN_FORWARDING_HELP_ARTICLE = 'https://www.godaddy.com/help/forward-my-godaddy-domain-12123'

const domainInputSchema = z.object({
    action: z.enum(['purchase', 'attach', 'forward']).describe(
        'purchase = buy/find new; attach = connect existing; forward = set up forwarding for secondary domain'
    ),
    brandName: z.string().optional().describe(
        'Business/project name for suggestions. NOT a domain — no dots/TLDs. Omit if user gave an exact domain.'
    ),
    domain: z.string().optional().describe(
        'FQDN with TLD (e.g. "my-sweet-store.com"). Only when user explicitly states one. Never fabricate.'
    ),
    appId: z.string().optional().describe('Defaults to current session app')
})

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
            message: 'Feature not enabled for this account.'
        }
    }

    // Proof-of-use: the purchased domain from the DPP handoff is now readable
    // programmatically (durable app_metadata, per-turn metadata fallback). Not
    // yet used to default the purchase target — that is a follow-up.
    const persistedFqdn = readAppFqdn(appId, context)
    if (persistedFqdn) {
        logger.info('domain.purchase.persisted-fqdn-available', { appId, persistedFqdn })
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
            message: 'Feature not enabled for this account.'
        }
    }

    // Proof-of-use: the purchased domain from the DPP handoff is now readable
    // programmatically (durable app_metadata, per-turn metadata fallback). Not
    // yet used to default the attach target — that is a follow-up.
    const persistedFqdn = readAppFqdn(appId, context)
    if (persistedFqdn) {
        logger.info('domain.attach.persisted-fqdn-available', { appId, persistedFqdn })
    }

    const socketId = context?.socketId
    if (!socketId || typeof socketId !== 'string') {
        logger.error('domain.attach.missing-socket-id', { appId })
        return {
            success: false,
            error: 'Socket ID not available',
            message: 'Cannot verify app status — try again.'
        }
    }

    const clientActionService = getActionService(socketId)
    if (!clientActionService) {
        logger.error('domain.attach.client-action-service-unavailable', { appId })
        return {
            success: false,
            error: 'Client action service unavailable',
            message: 'Cannot verify app status — try again.'
        }
    }

    const domain = input.domain?.trim() || undefined

    const { published, domains: siteDomains } = await getSiteContextForAttach(clientActionService, appId)
    if (!published) {
        if (domain) {
            await storePurchasedDomain(appId, domain, context)
        }
        logger.info('domain.attach.requires-publish', {
            appId,
            domain: domain || 'not-provided',
        })
        return {
            success: false,
            requiresPublish: true,
            error: 'App must be published before attaching a domain',
            message: 'App must be published first. Ask the user if they want to publish.'
        }
    }

    if (domain) {
        if (fqdnIsConnectedOrProvisioningOnSite(siteDomains, domain)) {
            logger.info('domain.attach.skip-already-on-app', { appId, domain })
            return {
                success: true,
                message: `${domain} already on this app (active or provisioning). Confirm with user — no attach needed.`
            }
        }
        await storePurchasedDomain(appId, domain, context)
        return autoAttach(clientActionService, appId, domain)
    }

    const primaryEntry = getConnectedOrProvisioningDomain(siteDomains)

    if (primaryEntry) {
        const primaryFqdn = primaryEntry.fqdn
        const isProvisioning = (primaryEntry.status ?? '').toLowerCase() !== 'active'
        logger.info('domain.attach.already-connected', { appId, primaryFqdn, isProvisioning })
        const statusNote = isProvisioning
            ? `${primaryFqdn} is being set up for this app (DNS is still propagating).`
            : `${primaryFqdn} is already connected to this app.`
        return {
            success: true,
            alreadyConnected: true,
            primaryDomain: primaryFqdn,
            message: `${statusNote} Tell the user the current status. Offer to forward additional domains to ${primaryFqdn} if they have other domains to point here.`,
        }
    }

    logger.info('domain.attach.render', {
        domain: 'not-provided',
        appId,
    })

    return {
        success: true,
        widgetType: 'domain-attach',
        widgetData: {
            type: 'domain-attach',
            brandName: domain || input.brandName,
            appId
        },
        message: messageForAttachWidget('Attach widget shown')
    }
}

/**
 * Auto-attach a domain to a published app via the client action service.
 * Falls back to the widget when the client-side action fails.
 */
async function autoAttach(
    clientActionService: NonNullable<ReturnType<typeof getActionService>>,
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

            // Persist domain state so agent context reflects the new domain
            try {
                const existingResult = await memoryRepo.get(appId, 'site.domains')
                const existing = existingResult.success && existingResult.exists && Array.isArray(existingResult.value)
                    ? existingResult.value as Array<{ fqdn: string; isPrimary: boolean; status: string }>
                    : []
                const updated = [...existing.filter(d => d.fqdn !== domain), { fqdn: domain, isPrimary: false, status: 'provisioning' }]
                await memoryRepo.set(appId, 'site.domains', updated)
            } catch (persistError) {
                logger.warn('domain.attach.auto.state-persist-failed', {
                    appId,
                    domain,
                    error: persistError instanceof Error ? persistError.message : String(persistError),
                })
            }

            return {
                success: true,
                message: `${domain} attached. DNS propagation may take a few minutes.`
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

    return {
        success: true,
        widgetType: 'domain-attach',
        widgetData: {
            type: 'domain-attach',
            brandName: domain,
            appId
        },
        message: messageForAttachWidget(
            `Auto-attach failed — showing attach widget for ${domain}`
        )
    }
}

async function forward(
    input: z.infer<typeof domainInputSchema>,
    context: any,
    appId: string
) {
    // No canPurchaseDomain gate — forwarding is guidance-only (no mutations), safe for all users.
    const socketId = context?.socketId
    if (!socketId || typeof socketId !== 'string') {
        logger.error('domain.forward.missing-socket-id', { appId })
        return {
            success: false,
            error: 'Socket ID not available',
            message: 'Cannot verify app status — try again.'
        }
    }

    const clientActionService = getActionService(socketId)
    if (!clientActionService) {
        logger.error('domain.forward.client-action-service-unavailable', { appId })
        return {
            success: false,
            error: 'Client action service unavailable',
            message: 'Cannot verify app status — try again.'
        }
    }

    const sourceDomain = input.domain?.trim() || undefined

    if (sourceDomain) {
        const validation = validateDomainName(sourceDomain)
        if (!validation.valid) {
            logger.warn('domain.forward.invalid-domain', {
                domain: sourceDomain,
                error: validation.error,
            })
            return {
                success: false,
                error: validation.error,
                message: `"${sourceDomain}" is not a valid domain name. ${validation.error}`
            }
        }
    }

    const { domains: siteDomains } = await getSiteContextForAttach(clientActionService, appId)

    // undefined = fetch failed (unknown state); [] = known empty
    if (!siteDomains) {
        return {
            success: false,
            error: 'Unable to check connected domains',
            message: 'Unable to check connected domains — please try again.',
        }
    }

    // SiteDomainForAttachCheck has no canonical "primary" flag or attachedAt timestamp,
    // so we pick the first active non-prefix domain. In practice apps have at most one
    // custom domain today; if multiple exist, API ordering is unspecified.
    const primaryDomain = siteDomains
        .filter((d) => d.domainType !== 'prefix')
        .find((d) => (d.status ?? '').toLowerCase() === 'active')
        ?.fqdn

    logger.info('domain.forward.instructions', {
        appId,
        sourceDomain: sourceDomain || 'not-provided',
        primaryDomain: primaryDomain || 'not-found',
    })

    if (!primaryDomain) {
        return {
            success: false,
            error: 'No primary domain attached',
            forwardingInstructions: {
                sourceDomain,
                helpArticle: DOMAIN_FORWARDING_HELP_ARTICLE,
            },
            message: 'No domain is currently attached to this app. Attach a primary domain first, then set up forwarding for additional domains.',
        }
    }

    const dccLink = sourceDomain
        ? `https://dcc.godaddy.com/control/portfolio/${sourceDomain}/settings?tab=forwarding`
        : undefined

    return {
        success: true,
        forwardingInstructions: {
            sourceDomain,
            primaryDomain,
            dccLink,
            helpArticle: DOMAIN_FORWARDING_HELP_ARTICLE,
        },
        message: buildForwardingMessage(sourceDomain, primaryDomain),
    }
}

function buildForwardingMessage(
    sourceDomain: string | undefined,
    primaryDomain: string,
): string {
    if (sourceDomain) {
        const dccLink = `https://dcc.godaddy.com/control/portfolio/${sourceDomain}/settings?tab=forwarding`
        return `To forward ${sourceDomain} to ${primaryDomain}: if ${sourceDomain} is a GoDaddy domain, set up forwarding at ${dccLink} using a 301 (Permanent) redirect. If it's registered elsewhere, set up a URL redirect/forward to ${primaryDomain} at that registrar. Full instructions: ${DOMAIN_FORWARDING_HELP_ARTICLE}`
    }
    return `Your app is live at ${primaryDomain}. To point additional domains here, set up domain forwarding — GoDaddy domains via DCC, external domains via the registrar's redirect settings. Instructions: ${DOMAIN_FORWARDING_HELP_ARTICLE}`
}

/**
 * Published flag and domain list from the browser site store (getSiteData).
 * If the call fails, published defaults true (fail open) to match prior checkPublished behavior.
 */
async function getSiteContextForAttach(
    clientActionService: NonNullable<ReturnType<typeof getActionService>>,
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
        logger.warn('domain.site-context.fetch-failed', {
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
async function storePurchasedDomain(appId: string, fqdn: string, context?: { metadata?: Record<string, unknown> }) {
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
            appId,
            customerIdFromContext(context)
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

export const domainPurchaseTool: SkillToolDefinition = {
    name: 'domainPurchase',
    description: `Purchase, attach, or forward a domain.

purchase: show domain search/buy widget.
attach: connect an existing domain to this app.
forward: explain how to set up domain forwarding for secondary domains.

Rules:
1. Call this tool immediately on domain requests (do not  prose-reply)
2. Re-call on each new domain message to re-render the widget (do not say "scroll up")
3. Paraphrase the result after one call per response (not a second call)
4. Tell the user when a domain is already connected (skip re-attach)
5. Pass **domain** param when user names a specific domain
6. Use this tool for all domain operations (do not redirect to Settings)
7. Call attach for DNS requests to show the official record table
8. Show the widget directly (skip clarifying questions)
9. Use only real DNS values from tool results (not fabricated or Preview URL \`*.preview.*\`)
10. For "forward" requests, guide the user through GoDaddy forwarding (DCC deep link) — never suggest attaching a second domain as primary`,
    parameters: domainInputSchema,
    execute: async (input, context) => {
        const appId = (context?.metadata?.appId as string) || input.appId
        if (!appId) {
            logger.error('domain.missing-app-id', {})
            return {
                success: false,
                error: 'App ID is required',
                message: 'App ID required for domain operations.'
            }
        }

        if (input.action === 'purchase') return purchase(input, context, appId)
        if (input.action === 'forward') return forward(input, context, appId)
        return attach(input, context, appId)
    },
    computeState(input: any, output: any) {
        if (input.action !== 'attach') return null;
        if (!output?.success || output?.widgetType || output?.requiresPublish) return null;
        const domain = input?.domain?.trim();
        if (!domain) return null;
        return { connectedDomain: domain, status: 'active' };
    },
}
