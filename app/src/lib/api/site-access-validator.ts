import { NextResponse } from 'next/server'

import type { CustomerAuthContext } from '@/lib/customer-auth'
import type { getPrismaClient } from '@/lib/prisma'

type PrismaClient = ReturnType<typeof getPrismaClient>

export interface SiteAccessValidationSuccess {
  siteId: string
  accountId: string
  site: Awaited<ReturnType<PrismaClient['sites']['findFirst']>>
}

export interface SiteAccessValidationError {
  error: NextResponse
}

export type SiteAccessValidationResult =
  | SiteAccessValidationSuccess
  | SiteAccessValidationError

/**
 * Validates that the authenticated user has access to the specified site
 *
 * @param siteId - The site ID to validate access for
 * @param authContext - The authenticated user context
 * @param prisma - Prisma client instance
 * @returns Validation result with site data or error response
 */
export async function validateSiteAccess(
  siteId: string | undefined,
  authContext: CustomerAuthContext,
  prisma: PrismaClient
): Promise<SiteAccessValidationResult> {
  const accountId = authContext.user.accountId

  if (!accountId) {
    return {
      error: NextResponse.json({ error: 'Account ID not found' }, { status: 400 })
    }
  }

  if (!siteId) {
    return {
      error: NextResponse.json({ error: 'Site ID is required' }, { status: 400 })
    }
  }

  const site = await prisma.sites.findFirst({
    where: { id: siteId },
    include: { account: true }
  })

  if (!site || site.account.shopper_id !== authContext.user.shopperId) {
    return {
      error: NextResponse.json({ error: 'Site not found or access denied' }, { status: 404 })
    }
  }

  return { siteId, accountId, site }
}

/**
 * Helper function to extract and validate site access from Next.js route params
 *
 * @param params - Next.js route params promise
 * @param authContext - The authenticated user context
 * @param prisma - Prisma client instance
 * @returns Validation result with site data or error response
 */
export async function validateSiteAccessFromParams(
  params: Promise<{ id: string }>,
  authContext: CustomerAuthContext,
  prisma: PrismaClient
): Promise<SiteAccessValidationResult> {
  const { id: siteId } = await params
  return validateSiteAccess(siteId, authContext, prisma)
}
