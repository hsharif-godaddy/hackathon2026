import { fqdnIsConnectedOrProvisioningOnSite, getConnectedOrProvisioningDomain, type SiteDomainForAttachCheck } from '@airo/shared'
import { emitCustomEvent } from '@godaddy/agent-otel-sdk'
import { z } from 'zod'

import type { SkillToolDefinition } from '@airo/ai-skills'

import { AppRepository } from '../../../database/repositories/AppRepository.js'
import type { App } from '../../../database/schema.js'
import { readAppFqdn } from '../../../lib/app-fqdn.js'
import { selectCacheConversationId } from '../../../server/budget-report-conversation-id.js'
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

    if (domain && fqdnIsConnectedOrProvisioningOnSite(siteDomains, domain)) {
        logger.info('domain.attach.skip-already-on-app', { appId, domain })
        return {
            success: true,
            alreadyConnected: true,
            message: `${domain} already on this app (active or provisioning). Confirm with user — no attach needed.`
        }
    }

    // Cross-account gate (AIROBUILD-2952): before storing or attaching, refuse a
    // domain registered to a DIFFERENT GoDaddy account — it cannot be connected
    // from here, and reporting success would be false. Fails open on any error.
    const ownership: DomainOwnership | undefined = domain
        ? await checkDomainOwnership(clientActionService, appId, domain)
        : undefined
    if (ownership?.crossAccount) {
        logger.warn('domain.attach.cross-account', { appId, domain })
        return {
            success: false,
            crossAccount: true,
            message: `${domain} is registered to a different GoDaddy account, so it can't be connected from this account. To use it, the user must either: (1) sign in to the GoDaddy account that owns ${domain} and point its DNS at this app, (2) transfer ${domain} into this account first, or (3) leave it where it is and set up domain forwarding to the published site. Do NOT tell the user the domain is or will be connected.`,
        }
    }

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
            message: domain
                ? `${domain} has been saved and will be automatically connected after publishing. Ask the user if they want to publish now and connect the domain in one step — if they agree, call the publish tool and the domain will be attached automatically.`
                : 'The app must be published before attaching a domain. Ask the user if they want to publish now — if they agree, call the publish tool. Once published, the domain can be connected.',
        }
    }

    if (domain) {
        await storePurchasedDomain(appId, domain, context)
        return autoAttach(clientActionService, appId, domain, ownership)
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

interface DomainOwnership {
    crossAccount: boolean
    isGdDomain?: boolean
    isGDDomainOwner?: boolean
}

/**
 * Pre-attach ownership check (AIROBUILD-2952). Asks the client action service to
 * look up the domain's GoDaddy registration/ownership via the BFF
 * domain-dns-ownership endpoint. `crossAccount` is true only when the domain is
 * registered at GoDaddy but owned by a different account
 * (isGdDomain && !isGDDomainOwner) — the case that must NOT be reported as
 * connected. Fails open (crossAccount: false) on any error so a transient lookup
 * failure never blocks a legitimate attach.
 */
async function checkDomainOwnership(
    clientActionService: NonNullable<ReturnType<typeof getActionService>>,
    appId: string,
    domain: string
): Promise<DomainOwnership> {
    try {
        const result = await clientActionService.executeAction({
            action: 'checkDomainOwnership',
            params: { appId, domainName: domain },
            timeoutMs: 10000,
        })
        if (!result.success || !result.result) return { crossAccount: false }
        const data = result.result as { isGdDomain?: boolean; isGDDomainOwner?: boolean }
        return {
            crossAccount: data.isGdDomain === true && data.isGDDomainOwner === false,
            isGdDomain: data.isGdDomain,
            isGDDomainOwner: data.isGDDomainOwner,
        }
    } catch (error) {
        logger.warn('domain.attach.ownership-check-failed', {
            appId,
            domain,
            error: error instanceof Error ? error.message : String(error),
        })
        return { crossAccount: false }
    }
}

/**
 * Auto-attach a domain to a published app via the client action service.
 * Falls back to the widget when the client-side action fails.
 */
async function autoAttach(
    clientActionService: NonNullable<ReturnType<typeof getActionService>>,
    appId: string,
    domain: string,
    ownership?: DomainOwnership
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

            const successMessage = ownership?.isGdDomain === true
                ? `${domain} connection started — GoDaddy is configuring the DNS automatically. The site goes live at ${domain} once DNS propagates (usually a few minutes). Do not claim it is already live; tell the user it is being set up.`
                : `${domain} connection started. Because ${domain} is registered outside GoDaddy, the user must point its DNS (A record) to this app at their registrar; propagation can take up to 48 hours. Do not claim it is already live; tell the user what they still need to do.`
            return {
                success: true,
                message: successMessage,
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
attach: connect an existing domain to this app — widget lists the user's existing GoDaddy domains with one-click connect, plus a purchase option for users who don't have one yet.
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
10. For "forward" requests, guide the user through GoDaddy forwarding (DCC deep link) — never suggest attaching a second domain as primary
11. **Default to attach when uncertain** — use purchase ONLY when user explicitly says "buy", "purchase", "find", or "get a new" domain; phrases like "connect a domain", "add my domain", "I need a domain", "let's set up a domain" all map to attach`,
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

        const app: App | null = appRepo.findById(appId)
        const conversationId: string | null = selectCacheConversationId(context).value ?? null
        emitCustomEvent({
            conversationId: conversationId ?? undefined,
            eventData: {
                schemaId: 'urn:shared:ai:event:/agent/domain/task-start/v1',
                data: {
                    action: input.action,
                    brandName: input.brandName ?? null,
                    domain: input.domain ?? null,
                    appName: app?.name ?? null,
                    appInitialPromptSnippet: app?.initialPrompt?.slice(0, 200) ?? null,
                    conversationId,
                },
            },
        })

        if (input.action === 'purchase') return purchase(input, context, appId)
        if (input.action === 'forward') return forward(input, context, appId)
        return attach(input, context, appId)
    },
    computeState(input: any, output: any) {
        if (input.action !== 'attach') return null;
        if (!output?.success || output?.widgetType || output?.requiresPublish || output?.alreadyConnected) return null;
        const domain = input?.domain?.trim();
        if (!domain) return null;
        return { connectedDomain: domain, status: 'provisioning' };
    },
}
