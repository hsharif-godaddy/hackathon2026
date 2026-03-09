import { NextRequest, NextResponse } from 'next/server'

import { getControlPlaneAdapter, isV2ControlPlaneEnabled } from '@/lib/control-plane/adapter-factory'
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth'
import { AiroHttpError } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

// Force dynamic rendering to prevent database calls during build
export const dynamic = 'force-dynamic'

/**
 * GET /api/servers/[id] - Get specific server details (authenticated)
 */
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  try {
    const { user } = authContext
    const { id: serverId } = await params
    const isV2 = isV2ControlPlaneEnabled()

    // For V2, get site directly from control plane adapter
    if (isV2) {
      const adapter = getControlPlaneAdapter()
      const jwt = authContext.jwt || ''

      // In V2, serverId IS the siteId (same as appId) - there are no separate "servers"
      // V2 apps run in the agent service, not as standalone dev servers
      const site = await adapter.getSite(serverId, jwt)

      if (!site) {
        return NextResponse.json({ error: 'Server not found' }, { status: 404 })
      }

      // In V2, return the preview URL even if status is 'creating' (optimistic URL construction)
      // The URL is constructed early so the iframe can start loading
      if (site.preview_url || site.agent_url) {
        const containerUrl = site.preview_url || site.agent_url
        const url = new URL(containerUrl)
        const port = parseInt(url.port) || (site.preview_url ? 5000 : 4000)

        const server = {
          appId: site.id,
          port: port,
          url: containerUrl,
          status: site.status === 'running' ? ('running' as const) : ('starting' as const),
          lastActivity: site.updated_at
        }

        return NextResponse.json({ server })
      } else {
        // No URL yet (early in creation process)
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
    }

    // Legacy: Use SiteAdapterFactory
    const { SiteAdapterFactory } = await import('@/lib/site-adapters/SiteAdapterFactory')
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
      if (!containerUrl) {
        return NextResponse.json({ error: 'No container URL available' }, { status: 404 })
      }
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
    const isAuthError = error instanceof AiroHttpError && (error.status === 401 || error.status === 403);
    logger[isAuthError ? 'warn' : 'error']('servers.get.error', {
      message: 'Failed to get server details',
      error: error instanceof Error ? error.message : String(error)
    })
    return NextResponse.json(
      { error: 'Failed to fetch server details', message: (error as Error).message },
      { status: error instanceof AiroHttpError ? error.status : 500 }
    )
  }
})
