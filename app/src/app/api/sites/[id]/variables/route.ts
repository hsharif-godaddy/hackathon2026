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
import { validateDomainName } from '@/lib/domain-validation'
import { logger } from '@/lib/request-context'

const ALLOWED_VARIABLE_KEYS = new Set(['lastInteractionAt', 'title', 'initialPrompt', 'airoSubscriptionId', 'fqdn'])

/**
 * Validate fqdn updates: trim, lowercase, then run the shared RFC 1035
 * validator the quick-create route uses (`@/lib/domain-validation`). This
 * keeps the API contract consistent across endpoints — same character set,
 * same length cap, same label rules, and the same normalized lowercase form
 * persisted into mgmt-airo. The adapter read side already type-guards, but
 * we reject malformed writes here so downstream consumers (publish, DPP,
 * BFF detail routes) never see them.
 *
 * Returns the normalized fqdn string on success, or a `{ error: string }`
 * object on rejection. Callers narrow with `typeof result === 'string'`.
 */
function validateFqdn(value: unknown): string | { error: string } {
  if (typeof value !== 'string') {
    return { error: 'fqdn must be a string' }
  }
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) {
    return { error: 'fqdn must not be empty' }
  }
  const result = validateDomainName(normalized)
  if (!result.valid) {
    return { error: result.error ?? 'fqdn is not a valid domain name' }
  }
  return normalized
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
