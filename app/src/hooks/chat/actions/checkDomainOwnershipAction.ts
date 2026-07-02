/**
 * Check Domain Ownership Action Executor
 *
 * Read-only pre-attach check: asks mgmt-airo (via the BFF) whether an FQDN is
 * registered at GoDaddy and, if so, whether it belongs to the CURRENT customer.
 * Used by the custom-domain skill to detect a domain owned by a different
 * GoDaddy account before attempting to attach it (AIROBUILD-2952).
 *
 * Throws on any failure so the agent-side caller can fail open (proceed with
 * attach) rather than block legitimate attaches on a transient lookup error.
 */

import { validateDomainName } from '@/lib/domain-validation'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import type { ClientActionExecutor } from './types'

interface DomainOwnershipResult {
    isGdDomain: boolean
    isGDDomainOwner: boolean
}

export const checkDomainOwnershipAction: ClientActionExecutor = async (params): Promise<DomainOwnershipResult> => {
    const { appId, domainName } = params

    if (!appId || typeof appId !== 'string') {
        throw new Error('appId is required and must be a string')
    }

    if (!domainName || typeof domainName !== 'string') {
        throw new Error('domainName is required and must be a string')
    }

    const validation: ReturnType<typeof validateDomainName> = validateDomainName(domainName)
    if (!validation.valid) {
        throw new Error(validation.error || 'Invalid domain name')
    }

    logger.info('domain.ownership-check.begin', { appId, domainName })

    const response: Response = await appFetch(
        `/api/sites/${appId}/domain-dns-ownership?fqdns=${encodeURIComponent(domainName)}`
    )

    if (!response.ok) {
        const errorData: { error?: string } = await response.json().catch(() => ({}))
        const errorMessage: string = errorData.error || `Failed to check domain ownership: ${response.status}`
        logger.error('domain.ownership-check.error', {
            appId,
            domainName,
            status: response.status,
            error: errorMessage,
        })
        throw new Error(errorMessage)
    }

    const data: DomainOwnershipResult = await response.json()

    logger.info('domain.ownership-check.success', {
        appId,
        domainName,
        isGdDomain: data.isGdDomain,
        isGDDomainOwner: data.isGDDomainOwner,
    })

    return {
        isGdDomain: data.isGdDomain,
        isGDDomainOwner: data.isGDDomainOwner,
    }
}
