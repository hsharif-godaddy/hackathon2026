/**
 * Attach Domain Action Executor
 *
 * Executes domain attachment for an app.
 * This is triggered by agents to automatically attach a purchased domain after publish.
 */

import { agentFetch } from '@/lib/agent-fetch'
import { DomainType } from '@/lib/control-plane/types'
import { validateDomainName } from '@/lib/domain-validation'
import { appFetch, AuthDismissedError } from '@/lib/gasket-config'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { useSiteStore } from '@/stores/useSiteStore'
import type { ClientActionExecutor } from './types'

export const attachDomainAction: ClientActionExecutor = async (params) => {
    const { appId, domainName } = params

    // Validate required parameters
    if (!appId || typeof appId !== 'string') {
        throw new Error('appId is required and must be a string')
    }

    if (!domainName || typeof domainName !== 'string') {
        throw new Error('domainName is required and must be a string')
    }

    // Validate domain name format using shared utility
    const validation = validateDomainName(domainName)
    if (!validation.valid) {
        throw new Error(validation.error || 'Invalid domain name')
    }

    try {
        logger.info('attach-domain-action.begin', {
            appId,
            domainName,
        })

        // Call the modify domains API to attach the domain
        const response = await appFetch(`/api/sites/${appId}/domains`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                domainsToCreate: [{ fqdn: domainName, primary: false }],
                createCdn: true,
            }),
        }, { authLevel: 3 })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
            const errorMessage = errorData.error || `Failed to attach domain: ${response.status}`

            logger.error('attach-domain-action.failed', {
                appId,
                domainName,
                status: response.status,
                error: errorMessage,
            })

            shipAnalyticsLog('domain.attach.action.failed', {
                appId,
                domainName,
                error: errorMessage,
            })

            throw new Error(errorMessage)
        }

        const result = await response.json()

        logger.info('attach-domain-action.success', {
            appId,
            domainName,
            statusJobId: result.statusJobId,
        })

        shipAnalyticsLog('domain.attach.action.success', {
            appId,
            domainName,
        })

        // Push domain state to agent so context reflects the new domain
        void (async () => {
            try {
                const site = useSiteStore.getState().getSite(appId)
                if (!site?.agent_url) return
                const existingDomains = (site.domains ?? [])
                    .filter(d => d.domainType !== DomainType.PREFIX && d.fqdn.toLowerCase() !== domainName.toLowerCase())
                    .map(d => ({
                        fqdn: d.fqdn,
                        isPrimary: d.isPrimary,
                        status: d.status,
                    }))
                await agentFetch(`${site.agent_url}/apps/${appId}/publish-state`, {
                    siteId: appId,
                    method: 'POST',
                    body: JSON.stringify({
                        domains: [...existingDomains, { fqdn: domainName, isPrimary: false, status: 'provisioning' }],
                    }),
                })
            } catch (err) {
                logger.warn('attach-domain-action.publish-state-push.failed', {
                    appId,
                    error: err instanceof Error ? err.message : String(err),
                })
            }
        })()

        return {
            success: true,
            domainName,
            statusJobId: result.statusJobId,
            status: result.status,
            message: result.message,
        }
    } catch (error) {
        if (error instanceof AuthDismissedError) return { cancelled: true }
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('attach-domain-action.error', {
            appId,
            domainName,
            error: errorMessage,
        })

        shipAnalyticsLog('domain.attach.action.error', {
            appId,
            domainName,
            error: errorMessage,
        })

        throw error
    }
}
