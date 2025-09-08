import { NextRequest, NextResponse } from 'next/server'
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory'
import { 
  withCustomerAuth, 
  customerHasAccount,
  createCustomerAuthError,
  type CustomerAuthContext 
} from '@/lib/customer-auth'

/**
 * GET /api/servers/[id] - Get specific server details (authenticated)
 */
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  try {
    const { user } = authContext
    const { id: serverId } = await params
    const siteAdapter = SiteAdapterFactory.getInstance()

    // Check auth requirements
    if (siteAdapter.requiresAuth() && !customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to view server details', 403)
    }

    // First check if there's a specific running dev server for this app
    const servers = await siteAdapter.getRunningServers()
    const runningServer = servers.find(server => server.appId === serverId)
    
    if (runningServer) {
      // Found a dedicated dev server (traditional development mode)
      return NextResponse.json({ server: runningServer })
    }
    
    // Fallback: check if there's a site with agent URL (agent-based mode)
    const site = await siteAdapter.getSiteById(serverId)
    
    if (!site) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    // Check if user has access to this site
    if (siteAdapter.requiresAuth() && site.account_id !== user.accountId) {
      return createCustomerAuthError('You can only access your own servers', 403)
    }

    // In agent-based mode, return the preview URL (Docker container URL) as the server URL
    if (site.status === 'running' && (site.preview_url || site.agent_url)) {
      // Prefer preview_url (actual Docker container) over agent_url (API endpoint)
      const containerUrl = site.preview_url || site.agent_url
      const url = new URL(containerUrl)
      const port = parseInt(url.port) || (site.preview_url ? 5000 : 4000)
      
      const server = {
        appId: site.id,
        port: port,
        url: containerUrl,
        status: 'running' as const,
        lastActivity: site.updated_at
      }
      
      return NextResponse.json({ server })
    } else {
      // Site exists but is not running
      return NextResponse.json({ 
        server: {
          appId: site.id,
          port: null,
          url: null,
          status: site.status,
          lastActivity: site.updated_at
        }
      })
    }
  } catch (error) {
    console.error('Failed to get server details:', error)
    return NextResponse.json(
      { error: 'Failed to fetch server details', message: (error as Error).message },
      { status: 500 }
    )
  }
})