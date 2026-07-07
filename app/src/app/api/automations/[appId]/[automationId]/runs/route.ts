import { NextRequest, NextResponse } from 'next/server'

import { getControlPlaneAdapter } from '@/lib/control-plane'
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth'
import { getMgmtAiroBaseUrl } from '@/lib/mgmt-airo/base-url'
import { logger } from '@/lib/request-context'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ appId: string; automationId: string }> }

/** Proxy to airo-go: GET .../automations/{id}/runs */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: RouteContext,
) => {
  const { appId, automationId } = await params
  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adapter = getControlPlaneAdapter()
  const site = await adapter.getSite(appId, authContext.jwt)
  if (!site) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 })
  }

  const { subscription_id: subscriptionId, system_id: systemId } = site
  if (!subscriptionId || !systemId) {
    return NextResponse.json({ error: 'App location not resolved' }, { status: 404 })
  }

  const limit = request.nextUrl.searchParams.get('limit') ?? '10'
  const offset = request.nextUrl.searchParams.get('offset') ?? '0'
  const url = `${getMgmtAiroBaseUrl()}/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/automations/${automationId}/runs?limit=${limit}&offset=${offset}`

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `sso-jwt ${authContext.jwt}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const body = await response.text()
      logger.warn('automations.runs.list.error', { appId, automationId, status: response.status, body })
      return NextResponse.json({ error: 'Failed to list runs' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (err) {
    logger.error('automations.runs.list.fetch_error', { appId, automationId, error: String(err) })
    return NextResponse.json({ error: 'Failed to list runs' }, { status: 502 })
  }
})

/** Proxy to airo-go: POST .../automations/{id}/run — triggers a manual run now */
export const POST = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: RouteContext,
) => {
  const { appId, automationId } = await params
  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adapter = getControlPlaneAdapter()
  const site = await adapter.getSite(appId, authContext.jwt)
  if (!site) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 })
  }

  const { subscription_id: subscriptionId, system_id: systemId } = site
  if (!subscriptionId || !systemId) {
    return NextResponse.json({ error: 'App location not resolved' }, { status: 404 })
  }

  const url = `${getMgmtAiroBaseUrl()}/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/automations/${automationId}/run`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `sso-jwt ${authContext.jwt}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const body = await response.text()
      logger.warn('automations.run.trigger.error', { appId, automationId, status: response.status, body })
      return NextResponse.json({ error: 'Failed to trigger run' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data, { status: 202 })
  } catch (err) {
    logger.error('automations.run.trigger.fetch_error', { appId, automationId, error: String(err) })
    return NextResponse.json({ error: 'Failed to trigger run' }, { status: 502 })
  }
})
