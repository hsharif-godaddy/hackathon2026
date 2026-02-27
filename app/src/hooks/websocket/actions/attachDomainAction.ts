/**
 * Attach Domain Action Executor
 *
 * Executes domain attachment for an app.
 * This is triggered by agents to automatically attach a purchased domain after publish.
 */

import { validateDomainName } from '@/lib/domain-validation'
import { appFetch } from '@/lib/gasket-config'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
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
        })

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

        return {
            success: true,
            domainName,
            statusJobId: result.statusJobId,
            status: result.status,
            message: result.message,
        }
    } catch (error) {
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
