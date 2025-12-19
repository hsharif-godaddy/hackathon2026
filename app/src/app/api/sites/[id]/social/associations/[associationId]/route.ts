import { NextRequest, NextResponse } from 'next/server'

import { validateSiteAccess } from '@/lib/api/site-access-validator'
import { type CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth'
import { getPrismaClient } from '@/lib/prisma'
import { logger } from '@/lib/request-context'
import { getErrorMessage } from '@/lib/social-utils'

export const dynamic = 'force-dynamic'

export const DELETE = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ id: string; associationId: string }> }
  ): Promise<NextResponse> => {
    try {
      const { id: siteId, associationId } = await params
      const prisma = getPrismaClient()

      if (!associationId) {
        return NextResponse.json(
          { error: 'Association ID is required' },
          { status: 400 }
        )
      }

      if (!authContext.jwt) {
        return NextResponse.json({ error: 'Authentication token required' }, { status: 401 })
      }

      const validation = await validateSiteAccess(siteId, authContext, prisma)

      if ('error' in validation) {
        return validation.error
      }

      const association = await prisma.social_associations.findFirst({
        where: {
          id: associationId,
          site_id: siteId,
        },
      })

      if (!association) {
        return NextResponse.json({ error: 'Association not found' }, { status: 404 })
      }

      await prisma.social_associations.delete({
        where: { id: associationId },
      })

      logger.info('social.associations.delete.success', {
        siteId,
        associationId,
        socialId: association.social_id,
        platform: association.platform
      })

      return NextResponse.json({ success: true })

    } catch (error) {
      logger.error('social.associations.delete.error', {
        message: 'Failed to delete site social association',
        error: getErrorMessage(error)
      })
      return NextResponse.json(
        { error: 'Failed to delete association' },
        { status: 500 }
      )
    }
  }
)
