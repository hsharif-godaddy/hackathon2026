import { NextRequest, NextResponse } from 'next/server'

import { getControlPlaneAdapter } from '@/lib/control-plane'
import {
  type CustomerAuthContext,
  withCustomerAuth,
} from '@/lib/customer-auth'
import { getMgmtAiroBaseUrl } from '@/lib/mgmt-airo/base-url'
import { logger } from '@/lib/request-context'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ appId: string; automationId: string }> }

/** Proxy to airo-go: PATCH /subscriptions/:sub/systems/:sys/apps/:appId/automations/:id */
export const PATCH = withCustomerAuth(async (
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

  const body = await request.json()
  const url = `${getMgmtAiroBaseUrl()}/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/automations/${automationId}`

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `sso-jwt ${authContext.jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const resBody = await response.text()
      logger.warn('automations.update.error', { appId, automationId, status: response.status, body: resBody })
      return NextResponse.json({ error: 'Failed to update automation' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (err) {
    logger.error('automations.update.fetch_error', { appId, automationId, error: String(err) })
    return NextResponse.json({ error: 'Failed to update automation' }, { status: 502 })
  }
})

/** Proxy to airo-go: DELETE /subscriptions/:sub/systems/:sys/apps/:appId/automations/:id */
export const DELETE = withCustomerAuth(async (
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

  const url = `${getMgmtAiroBaseUrl()}/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/automations/${automationId}`

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `sso-jwt ${authContext.jwt}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const resBody = await response.text()
      logger.warn('automations.delete.error', { appId, automationId, status: response.status, body: resBody })
      return NextResponse.json({ error: 'Failed to delete automation schedule' }, { status: response.status })
    }

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    logger.error('automations.delete.fetch_error', { appId, automationId, error: String(err) })
    return NextResponse.json({ error: 'Failed to delete automation schedule' }, { status: 502 })
  }
})
