import { NextRequest, NextResponse } from 'next/server';

import { CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { VentureService } from '@/lib/venture-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects - Get customer projects with billing information
 *
 * Returns paginated customer projects including group, status, and billing details.
 * Uses cursor-based pagination with the 'after' query parameter.
 *
 * @param request - Next.js request object
 * @param authContext - Authenticated customer context
 * @returns JSON response with projects data or error
 *
 * Query Parameters:
 * - after: Cursor for pagination (optional)
 *
 * Response:
 * {
 *   "projects": {
 *     "edges": [
 *       {
 *         "node": {
 *           "group": "string",
 *           "status": "string",
 *           "billing": {
 *             "id": "string",
 *             "plan": "string"
 *           }
 *         }
 *       }
 *     ],
 *     "pageInfo": {
 *       "hasNextPage": boolean,
 *       "endCursor": "string"
 *     }
 *   }
 * }
 */
export const GET = withCustomerAuth(
  async (request: NextRequest, authContext: CustomerAuthContext) => {
    try {
      const { user } = authContext;
      const { searchParams } = new URL(request.url);
      const after = searchParams.get('after') || undefined;
      logger.info('api.projects.get.start', {
        message: 'Starting customer projects fetch',
        customerId: user.customerId,
        shopperId: user.shopperId,
        after,
      });
      // Create venture service instance
      const ventureService = new VentureService(authContext.jwt);

      // Fetch customer projects
      const projectsData = await ventureService.getCustomerProjects(user.customerId, after);
      logger.info('api.projects.get.success', {
        message: 'Successfully fetched customer projects',
        customerId: user.customerId,
        projectCount: projectsData.projects?.edges?.length || 0,
        hasNextPage: projectsData.projects?.pageInfo?.hasNextPage,
        after,
      });

      return NextResponse.json({
        success: true,
        data: projectsData,
      });

    } catch (error) {
      logger.error('api.projects.get.failed', {
        message: 'Failed to fetch customer projects',
        error: error instanceof Error ? error.message : String(error),
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch projects',
          message: error instanceof Error ? error.message : 'Unknown error occurred',
        },
        { status: 500 }
      );
    }
  }
);
