/**
 * API route for fetching or creating venture ID
 * Provides server-side access to GraphQL venture service
 */

import { NextRequest, NextResponse } from 'next/server';

import { CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { auth } from '@/lib/features';
import { logger } from '@/lib/request-context';
import { VentureService } from '@/lib/venture-service';

export const dynamic = 'force-dynamic';

// Local dev rarely has S2S Product Graph certs configured. Without
// GRAPHQL_CLIENT_CERT (env or file), VentureService blocks for 30+s on each
// SSO timeout, which compounds into multi-minute /api/sites and /api/venture
// responses. Mirror the guard already present in `ensure-app-venture.ts`.
function hasProductGraphCert(): boolean {
    if (process.env.GRAPHQL_CLIENT_CERT && process.env.GRAPHQL_CLIENT_KEY) return true;
    return Boolean(process.env.GRAPHQL_CLIENT_CERT_PATH && process.env.GRAPHQL_CLIENT_KEY_PATH);
}

/**
 * GET /api/venture - Get or create venture ID for authenticated user
 *
 * Uses mgmt-airo attributes API to fetch existing venture ID.
 * Falls back to GraphQL API to create new venture if not found.
 *
 * @param request - Next.js request object
 * @param authContext - Authenticated customer context
 * @returns JSON response with venture ID or error
 */
export const GET = withCustomerAuth(
    async (request: NextRequest, authContext: CustomerAuthContext) => {
        try {
            const { user, jwt } = authContext;

            // In development mode, skip venture API calls and return mock venture ID
            // This avoids 5-15 second delays from failed authentication attempts
            if (auth.isMock()) {
                logger.info('api.venture.get.mock', {
                    message: 'Skipping venture API call in development mode',
                    customerId: user.customerId,
                });

                return NextResponse.json({
                    success: true,
                    ventureId: `mock-venture-${user.customerId}`,
                });
            }

            // Short-circuit when Product Graph S2S certs aren't configured.
            // Otherwise VentureService.createProfileForShopper hangs ~30s per SSO
            // retry (a real problem on dev machines running local.test/local.prod
            // without certs). We do NOT fabricate a venture id here — a fake id
            // would build broken Dashboard / AssetManager links pointing at a
            // non-existent venture. Return an explicit "unavailable" instead:
            // logged as an error in deployed environments (certs are always
            // provisioned there, so a miss is a real misconfiguration to alert on)
            // and a warning locally. 404 keeps useVenture from retrying.
            if (!hasProductGraphCert()) {
                const isDeployed = process.env.NODE_ENV === 'production';
                const log = isDeployed ? logger.error : logger.warn;
                log('api.venture.get.no-cert', {
                    message: 'Product Graph cert not configured; venture lookup unavailable',
                    customerId: user.customerId,
                    deployed: isDeployed,
                });
                return NextResponse.json(
                    { success: false, error: 'Venture service is not configured' },
                    { status: 404 }
                );
            }

            if (!user.customerId) {
                return NextResponse.json(
                    { error: 'Customer ID not available' },
                    { status: 400 }
                );
            }

            if (!user.shopperId) {
                return NextResponse.json(
                    { error: 'Shopper ID not available' },
                    { status: 400 }
                );
            }

            if (!jwt) {
                return NextResponse.json(
                    { error: 'JWT token not available' },
                    { status: 401 }
                );
            }

            // Create venture service with JWT for mgmt-airo API calls
            const ventureService = new VentureService(jwt);

            // Get or create venture ID
            // First tries mgmt-airo attributes API, then creates via GraphQL if needed
            const ventureId = await ventureService.getOrCreateVentureForCustomer(
                user.customerId,
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
