/**
 * API route for fetching or creating venture ID
 * Provides server-side access to GraphQL venture service
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCustomerAuth, CustomerAuthContext } from '@/lib/customer-auth';
import { VentureService } from '@/lib/venture-service';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/venture - Get or create venture ID for authenticated user
 *
 * Uses certificate-based S2S authentication to query GraphQL API.
 *
 * @param request - Next.js request object
 * @param authContext - Authenticated customer context
 * @returns JSON response with venture ID or error
 */
export const GET = withCustomerAuth(
    async (request: NextRequest, authContext: CustomerAuthContext) => {
        try {
            const { user } = authContext;

            if (!user.shopperId) {
                return NextResponse.json(
                    { error: 'Shopper ID not available' },
                    { status: 400 }
                );
            }

            // Create venture service (uses certificate-based S2S auth internally)
            const ventureService = new VentureService();

            // Get or create venture ID (gets latest shopper venture or creates new profile)
            const ventureId = await ventureService.getOrCreateVentureForShopper(
                user.shopperId
            );

            return NextResponse.json({
                success: true,
                ventureId,
            });
        } catch (error) {
            logger.error('api.venture.get.failed', {
                message: 'Failed to get or create venture ID',
                error: error instanceof Error ? error.message : String(error),
            });

            return NextResponse.json(
                {
                    success: false,
                    error:
                        error instanceof Error ? error.message : 'Unknown error occurred',
                },
                { status: 500 }
            );
        }
    }
);
