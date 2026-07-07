import { NextRequest, NextResponse } from 'next/server'

import { getControlPlaneAdapter } from '@/lib/control-plane'
import {
  type CustomerAuthContext,
  withCustomerAuth,
} from '@/lib/customer-auth'
import { getMgmtAiroBaseUrl } from '@/lib/mgmt-airo/base-url'
import { logger } from '@/lib/request-context'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ appId: string }> }

/** Proxy to airo-go: GET /subscriptions/:sub/systems/:sys/apps/:appId/automations */
export const GET = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: RouteContext,
) => {
  const { appId } = await params
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

  const url = `${getMgmtAiroBaseUrl()}/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/automations`

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `sso-jwt ${authContext.jwt}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const body = await response.text()
      logger.warn('automations.list.error', { appId, status: response.status, body })
      return NextResponse.json({ error: 'Failed to list automations' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (err) {
    logger.error('automations.list.fetch_error', { appId, error: String(err) })
    return NextResponse.json({ error: 'Failed to list automations' }, { status: 502 })
  }
})

/** Proxy to airo-go: POST /subscriptions/:sub/systems/:sys/apps/:appId/automations */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: RouteContext,
) => {
  const { appId } = await params
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

  const body = await request.json()
  const url = `${getMgmtAiroBaseUrl()}/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/automations`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `sso-jwt ${authContext.jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const resBody = await response.text()
      logger.warn('automations.create.error', { appId, status: response.status, body: resBody })
      // Forward airo-go's structured error body so the client can inspect the code
      // (e.g. AUTOMATION_QUOTA_EXCEEDED) rather than receiving a generic string.
      try {
        return NextResponse.json(JSON.parse(resBody), { status: response.status })
      } catch {
        return NextResponse.json({ error: 'Failed to create automation' }, { status: response.status })
      }
    }

    const data = await response.json()
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    logger.error('automations.create.fetch_error', { appId, error: String(err) })
    return NextResponse.json({ error: 'Failed to create automation' }, { status: 502 })
  }
})
