import { NextRequest, NextResponse } from 'next/server'

import { agentFetch } from '@/lib/agent-fetch'
import { resolveAgentsBaseUrl } from '@/lib/agents-base-url'
import { getControlPlaneAdapter } from '@/lib/control-plane'
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth'
import type { PulseAnalyzeRequest, PulseAnalyzeResponse } from '@/lib/pulse/types'
import { logger } from '@/lib/request-context'

export const dynamic = 'force-dynamic'

export const POST = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
  ): Promise<NextResponse> => {
    try {
      if (!authContext.jwt) {
        return NextResponse.json({ status: 'error', message: 'Authentication token required' }, { status: 401 })
      }

      const body = await request.json() as Partial<PulseAnalyzeRequest>
      const { appId, publishedUrl } = body

      if (!appId) {
        return NextResponse.json({ status: 'error', message: 'appId is required' }, { status: 400 })
      }
      if (!publishedUrl) {
        return NextResponse.json({ status: 'error', message: 'publishedUrl is required' }, { status: 400 })
      }

      if (process.env.AUTH_TYPE === 'mock') {
        const mockInsights: Record<string, PulseAnalyzeResponse> = {
          benbakery01: {
            status: 'insight',
            insight: {
              problemType: 'cta_buried',
              headline: '48 people visited this week. Only 2 placed an order.',
              description: "Your 'Order Now' button doesn't appear until visitors scroll past a wall of text. Most people leave without ever seeing it — you're losing orders before they have a chance to happen.",
              suggestedFix: "Move the 'Order Now' button into the hero section so it's the first thing visitors see.",
              confidence: 0.88,
              screenshotBase64: '',
              filesRead: ['src/pages/index.tsx'],
            },
          },
          marcospizza01: {
            status: 'insight',
            insight: {
              problemType: 'contact_hidden',
              headline: '62 people visited this week. Only 3 reached out.',
              description: "Your contact form asks for 6 fields and is buried 4 scrolls down the page. The friction is too high — most people give up before they ever find it.",
              suggestedFix: 'Simplify the contact form to just name and phone number, and surface it above the fold.',
              confidence: 0.94,
              screenshotBase64: '',
              filesRead: ['src/pages/index.tsx'],
            },
          },
        }
        const mockResponse: PulseAnalyzeResponse = mockInsights[appId] ?? {
          status: 'insight',
          insight: {
            problemType: 'no_social_proof',
            headline: '31 people visited this week. Only 1 contacted you.',
            description: "Your candle shop has no customer reviews visible anywhere. First-time visitors need to see that real people have bought from you before they'll reach out — without that trust signal, most leave quietly.",
            suggestedFix: 'Add a testimonials section with 3 customer reviews to your homepage.',
            confidence: 0.91,
            screenshotBase64: '',
            filesRead: ['src/pages/index.tsx'],
          },
        }
        return NextResponse.json(mockResponse satisfies PulseAnalyzeResponse)
      }

      const adapter = getControlPlaneAdapter()
      const site = await adapter.getSite(appId, authContext.jwt)

      if (!site) {
        return NextResponse.json({ status: 'error', message: 'Site not found' }, { status: 404 })
      }

      const agentBaseUrl: string = resolveAgentsBaseUrl(site)
      const agentUrl = `${agentBaseUrl}/apps/${appId}/pulse-analyze`

      const agentResponse = await agentFetch(agentUrl, {
        siteId: appId,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishedUrl }),
      })

      const result = await agentResponse.json() as PulseAnalyzeResponse

      if (!agentResponse.ok) {
        logger.error('pulse.analyze.agent.error', {
          appId,
          status: agentResponse.status,
        })
        return NextResponse.json(result, { status: agentResponse.status })
      }

      logger.info('pulse.analyze.complete', { appId, status: result.status })
      return NextResponse.json(result)
    } catch (error: unknown) {
      logger.error('pulse.analyze.error', {
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json(
        { status: 'error', message: 'Pulse analysis failed' } satisfies PulseAnalyzeResponse,
        { status: 500 },
      )
    }
  },
)
