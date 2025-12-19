import { NextRequest, NextResponse } from 'next/server'

import { validateSiteAccessFromParams } from '@/lib/api/site-access-validator'
import { type CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth'
import { getPrismaClient, SocialPlatformType } from '@/lib/prisma'
import { logger } from '@/lib/request-context'
import { getErrorMessage } from '@/lib/social-utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/sites/:id/social/associations
 * Get all social connection associations for a site
 * Returns just the association records (social_id, platform)
 * Frontend should enrich with data from social-v2 API
 */
export const GET = withCustomerAuth(
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

      const associations = await prisma.social_associations.findMany({
        where: {
          site_id: siteId,
        },
        orderBy: { created_at: 'desc' }
      })

      logger.info('social.associations.list.success', {
        siteId,
        count: associations.length
      })

      return NextResponse.json({ associations })

    } catch (error) {
      logger.error('social.associations.list.error', {
        error: getErrorMessage(error)
      })
      return NextResponse.json(
        { error: 'Failed to fetch associations' },
        { status: 500 }
      )
    }
  }
)

/**
 * POST /api/sites/:id/social/associations
 * Create a new association between a site and a social connection
 * Body: { socialId: string, platform: string }
 */
export const POST = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ id: string }> }
  ): Promise<NextResponse> => {
    try {
      const prisma = getPrismaClient()
      const body = await request.json()

      const { socialId, platform } = body

      if (!socialId || typeof socialId !== 'string' || socialId.trim().length === 0) {
        return NextResponse.json(
          { error: 'socialId must be a non-empty string' },
          { status: 400 }
        )
      }

      if (socialId.length > 255) {
        return NextResponse.json(
          { error: 'socialId must not exceed 255 characters' },
          { status: 400 }
        )
      }

      const validation = await validateSiteAccessFromParams(params, authContext, prisma)

      if ('error' in validation) {
        return validation.error
      }

      const { siteId } = validation

      const association = await prisma.social_associations.create({
        data: {
          site_id: siteId,
          social_id: socialId,
          platform: platform as SocialPlatformType,
        },
      })

      logger.info('social.associations.create.success', {
        siteId,
        socialId,
        platform,
        associationId: association.id
      })

      return NextResponse.json({ association }, { status: 201 })

    } catch (error) {
      logger.error('social.associations.create.error', {
        error: getErrorMessage(error)
      })
      return NextResponse.json(
        { error: 'Failed to create association' },
        { status: 500 }
      )
    }
  }
)
