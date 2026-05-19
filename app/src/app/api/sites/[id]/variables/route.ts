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

const ALLOWED_VARIABLE_KEYS = new Set(['lastInteractionAt', 'title', 'initialPrompt', 'airoSubscriptionId', 'fqdn'])

const FQDN_MAX_LENGTH = 253 // practical DNS FQDN length cap

/**
 * Validate fqdn updates: must be a non-empty string ≤253 chars. The adapter
 * read side already type-guards, but we reject malformed writes at the BFF so
 * downstream consumers never see them and so the API returns a clear 400
 * instead of silently dropping the field.
 *
 * Returns the normalized fqdn string on success, or a `{ error: string }`
 * object on rejection. Callers narrow with `typeof result === 'string'` —
 * a primitive type guard that always narrows reliably across TS configs.
 */
function validateFqdn(value: unknown): string | { error: string } {
  if (typeof value !== 'string') {
    return { error: 'fqdn must be a string' }
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return { error: 'fqdn must not be empty' }
  }
  if (trimmed.length > FQDN_MAX_LENGTH) {
    return { error: `fqdn must be at most ${FQDN_MAX_LENGTH} characters` }
  }
  return trimmed
}

// PATCH /api/sites/[id]/variables - Update site variables
export const PATCH = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id: siteId } = await params
    const rawUpdates = await request.json()
    if (!rawUpdates || typeof rawUpdates !== 'object' || Array.isArray(rawUpdates)) {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 })
    }
    const variableUpdates: Record<string, unknown> = {}
    for (const key of Object.keys(rawUpdates)) {
      if (!ALLOWED_VARIABLE_KEYS.has(key)) continue
      if (key === 'fqdn') {
        const result = validateFqdn(rawUpdates[key])
        if (typeof result === 'string') {
          variableUpdates[key] = result
        } else {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
      } else {
        variableUpdates[key] = rawUpdates[key]
      }
    }
    if (Object.keys(variableUpdates).length === 0) {
      return NextResponse.json({ error: 'No valid variable keys provided' }, { status: 400 })
    }
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
})
