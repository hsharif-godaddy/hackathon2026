/**
 * Site Variables API
 *
 * PATCH /api/sites/[id]/variables - Update site variables (metadata)
 */

import { NextRequest, NextResponse } from 'next/server'

import { getControlPlaneAdapter } from '@/lib/control-plane'
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth
} from '@/lib/customer-auth'
import { logger } from '@/lib/request-context'

// PATCH /api/sites/[id]/variables - Update site variables
export const PATCH = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id: siteId } = await params
    const variableUpdates = await request.json()
    const { user } = authContext

    // Customer must have an account to update sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to update site variables', 403)
    }

    if (!siteId) {
      return NextResponse.json({ error: 'Site ID is required' }, { status: 400 })
    }

    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 })
    }

    const adapter = getControlPlaneAdapter()

    // Check site exists and ownership
    const existingSite = await adapter.getSite(siteId, authContext.jwt)

    if (!existingSite) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }

    // Update site variables via adapter
    const updatedSite = await adapter.updateSiteVariables(siteId, variableUpdates, authContext.jwt)

    if (!updatedSite) {
      return NextResponse.json({ error: 'Failed to update site variables' }, { status: 404 })
    }

    logger.info('sites.variables.update.success', {
      message: 'Site variables updated by authenticated customer',
      siteId,
      accountId: user.accountId,
      variables: Object.keys(variableUpdates)
    })

    return NextResponse.json(updatedSite)
  } catch (error) {
    logger.error('sites.variables.update.error', {
      error: error instanceof Error ? error.message : String(error)
    })
    return NextResponse.json(
      { error: 'Failed to update site variables' },
      { status: 500 }
    )
  }
}, { level: 3 })
