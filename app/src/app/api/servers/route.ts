import { NextRequest, NextResponse } from 'next/server'

import { 
  createCustomerAuthError,
  type CustomerAuthContext, 
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth'
import { logger } from '@/lib/request-context'
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory'

// Force dynamic rendering to prevent database calls during build
export const dynamic = 'force-dynamic'

/**
 * GET /api/servers - Get running servers (authenticated)
 */
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  try {
    const { user } = authContext
    const siteAdapter = SiteAdapterFactory.getInstance()

    logger.info('api.servers.fetch.start', 'Fetching running servers')

    // Check auth requirements
    if (siteAdapter.requiresAuth() && !customerHasAccount(user)) {
      logger.warn('api.servers.access.denied', 'User attempted to access servers without account')
      return createCustomerAuthError('You must have an account to view servers', 403)
    }

    const servers = await siteAdapter.getRunningServers()
    
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
