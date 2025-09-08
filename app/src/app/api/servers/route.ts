import { NextRequest, NextResponse } from 'next/server'
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory'
import { 
  withCustomerAuth, 
  customerHasAccount,
  createCustomerAuthError,
  type CustomerAuthContext 
} from '@/lib/customer-auth'

/**
 * GET /api/servers - Get running servers (authenticated)
 */
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  try {
    const { user } = authContext
    const siteAdapter = SiteAdapterFactory.getInstance()

    // Check auth requirements
    if (siteAdapter.requiresAuth() && !customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to view servers', 403)
    }

    const servers = await siteAdapter.getRunningServers()
    
    return NextResponse.json({ servers })
  } catch (error) {
    console.error('Failed to get running servers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch servers', message: (error as Error).message },
      { status: 500 }
    )
  }
})