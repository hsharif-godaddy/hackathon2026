import { NextRequest, NextResponse } from 'next/server'

import { validateSiteAccessFromParams } from '@/lib/api/site-access-validator'
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth'
import { getPrismaClient } from '@/lib/prisma'
import { logger } from '@/lib/request-context'
import { getErrorMessage } from '@/lib/social-utils'

export const dynamic = 'force-dynamic'

export const POST = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ id: string }> }
  ): Promise<NextResponse> => {
    try {
      const prisma = getPrismaClient()
      const validation = await validateSiteAccessFromParams(params, authContext, prisma)

      if ('error' in validation) {
        return validation.error
      }

      const { siteId } = validation

      const body = await request.json()

      const {
        association_id,
        platform,
        state,
        payload,
        external_response,
        external_id,
        completed_at,
        campaign_id,
        scheduled_at
      } = body

      if (!platform || !state || !payload) {
        return NextResponse.json(
          { error: 'platform, state, and payload are required' },
          { status: 400 }
        )
      }

      const post = await prisma.social_posts.create({
        data: {
          site_id: siteId,
          association_id: association_id || null,
          platform,
          state,
          payload,
          external_response: external_response || null,
          external_id: external_id || null,
          completed_at: completed_at ? new Date(completed_at) : new Date(),
          campaign_id: campaign_id || null,
          scheduled_at: scheduled_at ? new Date(scheduled_at) : null,
          created_by: 'agent'
        }
      })

      logger.info('social.posts.create.success', {
        siteId,
        postId: post.id,
        platform,
        state,
        external_id: post.external_id
      })

      return NextResponse.json({ post }, { status: 201 })

    } catch (error) {
      const errorMessage = getErrorMessage(error)
      logger.error('social.posts.create.error', {
        error: errorMessage
      })

      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2002') {
          return NextResponse.json(
            { error: 'A post with this external_id already exists' },
            { status: 409 }
          )
        }
        if (error.code === 'P2003') {
          return NextResponse.json(
            { error: 'Invalid site_id or association_id reference' },
            { status: 400 }
          )
        }
      }

      const status = error && typeof error === 'object' && 'status' in error
        ? (error.status as number)
        : 550

      return NextResponse.json(
        { error: 'Failed to create post', details: errorMessage },
        { status }
      )
    }
  }
)
