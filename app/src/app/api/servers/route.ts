import { NextRequest, NextResponse } from 'next/server'

import { getControlPlaneAdapter } from '@/lib/control-plane'
import { SiteStatus } from '@/lib/control-plane/types'
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth'
import { logger } from '@/lib/request-context'

// Force dynamic rendering to prevent database calls during build
export const dynamic = 'force-dynamic'

/**
 * GET /api/servers - Get running servers (authenticated)
 *
 * Lists all sites for the current user, mapped to the server shape
 * expected by the client (AppService.ts).
 */
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  try {
    const { user } = authContext

    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to view servers', 403)
    }

    logger.info('api.servers.fetch.start', { message: 'Fetching running servers' })

    const adapter = getControlPlaneAdapter()
    const sites = await adapter.listSites(authContext.jwt || '')

    // Map sites to the server shape expected by the client
    const servers = sites
      .filter(site => site.status === SiteStatus.Running && (site.preview_url || site.agent_url))
      .map(site => {
        const containerUrl = site.preview_url || site.agent_url
        const url = containerUrl ? new URL(containerUrl) : null
        const port = url ? (parseInt(url.port) || (site.preview_url ? 5000 : 4000)) : null

        return {
          appId: site.id,
          port,
          url: containerUrl,
          status: 'running' as const,
          lastActivity: site.updated_at
        }
      })

    logger.info('api.servers.fetch.success', {
      message: `Found ${servers.length} running servers`,
      serverCount: servers.length
    })
    return NextResponse.json({ servers })
  } catch (error) {
    logger.error('api.servers.fetch.error', {
      message: 'Failed to get running servers',
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    }, {
      error: error instanceof Error ? error : undefined
    })
    return NextResponse.json(
      { error: 'Failed to fetch servers', message: (error as Error).message },
      { status: 500 }
    )
  }
})
