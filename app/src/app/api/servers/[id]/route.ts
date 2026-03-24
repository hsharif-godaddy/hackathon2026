import { NextRequest, NextResponse } from 'next/server'

import { getControlPlaneAdapter } from '@/lib/control-plane/adapter-factory'
import {
  type CustomerAuthContext,
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
    const { id: serverId } = await params
    const adapter = getControlPlaneAdapter()
    const jwt = authContext.jwt || ''

    // In V2, serverId IS the siteId (same as appId) - there are no separate "servers"
    // V2 apps run in the agent service, not as standalone dev servers
    const site = await adapter.getSite(serverId, jwt)

    if (!site) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    // Return the preview URL even if status is 'creating' (optimistic URL construction)
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
