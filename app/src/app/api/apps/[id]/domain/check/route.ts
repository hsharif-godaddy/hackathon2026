import { NextRequest, NextResponse } from 'next/server';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { type AiroDomainCheckResponse, AiroMgmtClient, DomainMode, DomainValidationError } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/apps/[id]/domain/check - Check domain availability
 *
 * Validates if a domain (project prefix or custom domain) is available via mgmt-airo API
 * Passes through response with error IDs for frontend handling
 *
 * @param request - Next.js request object with query params:
 *   - domain: The domain value to check (required)
 *   - mode: 'project' or 'custom' (optional, defaults to 'project')
 * @param authContext - Customer authentication context
 * @param params - Route context with params: { id: string }
 * @returns Validation response with availability status and error details
 *
 * @example
 * // Request (project mode - default)
 * GET /api/apps/abc123/domain/check?domain=my-subdomain
 * // or explicitly:
 * GET /api/apps/abc123/domain/check?domain=my-subdomain&mode=project
 *
 * // Internally calls mgmt-airo with:
 * // GET .../domain/check?mode=project&projectPrefix=my-subdomain
 *
 * // Request (custom mode)
 * GET /api/apps/abc123/domain/check?domain=example.com&mode=custom
 *
 * // Internally calls mgmt-airo with:
 * // GET .../domain/check?mode=custom&fqdn=example.com
 *
 * // Response (available)
 * {
 *   "available": true,
 *   "mode": "project",
 *   "projectPrefix": "my-subdomain",
 *   "domain": "my-subdomain.airoapp.ai"
 * }
 *
 * // Response (unavailable)
 * {
 *   "available": false,
 *   "mode": "project",
 *   "errors": [{
 *     "code": "DOMAIN_RESERVED",
 *     "message": "Project prefix 'admin' is reserved and cannot be used",
 *     "field": "projectPrefix",
 *     "value": "admin"
 *   }]
 * }
 */
export const GET = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ id: string }> }
  ): Promise<NextResponse> => {
    try {
      const { id: appId } = await params;
      const { user } = authContext;

      // Customer must have an account to check domain availability
      if (!customerHasAccount(user)) {
        return createCustomerAuthError(
          'You must have an account to check domain availability',
          403
        );
      }

      // Validate appId
      if (!appId) {
        return NextResponse.json(
          { error: 'App ID is required' },
          { status: 400 }
        );
      }

      // JWT required
      if (!authContext.jwt) {
        return NextResponse.json(
          { error: 'Authentication token required' },
          { status: 401 }
        );
      }

      // Get parameters from query params
      const { searchParams } = new URL(request.url);
      const modeParam = searchParams.get('mode') || DomainMode.PROJECT;
      const domain = searchParams.get('domain');
      const subscriptionIdParam = searchParams.get('subscriptionId');
      const systemIdParam = searchParams.get('systemId');

      if (!domain || typeof domain !== 'string') {
        return NextResponse.json(
          { error: 'Domain parameter is required' },
          { status: 400 }
        );
      }

      // Validate mode
      if (modeParam !== DomainMode.PROJECT && modeParam !== DomainMode.CUSTOM) {
        return NextResponse.json(
          { error: 'Mode must be either "project" or "custom"' },
          { status: 400 }
        );
      }

      const mode = modeParam as DomainMode;

      logger.info('check-domain-availability.api.start', {
        appId,
        mode,
        domain,
        accountId: user.accountId,
        hasProvidedIds: !!(subscriptionIdParam && systemIdParam)
      });

      // Get subscription and system IDs (from params if provided, otherwise fetch)
      let subscriptionId: string;
      let systemId: string;

      if (subscriptionIdParam && systemIdParam) {
        subscriptionId = subscriptionIdParam;
        systemId = systemIdParam;
        
        logger.info('check-domain-availability.api.using-provided-ids', {
          appId,
          message: 'Using subscription/system IDs from query params'
        });
      } else {
        // Fallback: Fetch from control plane (slower but always works)
        const adapter = getControlPlaneAdapter();
        const site = await adapter.getSite(appId, authContext.jwt);

        if (!site) {
          return NextResponse.json(
            { error: 'Site not found' },
            { status: 404 }
          );
        }

        // Check if site has subscription and system IDs (required for mgmt-airo)
        if (!site.subscription_id || !site.system_id) {
          logger.warn('check-domain-availability.api.no-ids', {
            appId,
            hasSubscriptionId: !!site.subscription_id,
            hasSystemId: !!site.system_id,
          });
          return NextResponse.json(
            { error: 'Site does not have required configuration' },
            { status: 400 }
          );
        }

        subscriptionId = site.subscription_id;
        systemId = site.system_id;
        
        logger.info('check-domain-availability.api.fetched-ids', {
          appId,
          message: 'Fetched subscription/system IDs from control plane'
        });
      }

      // Create mgmt-airo client and check domain availability
      const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
      const client = new AiroMgmtClient({
        baseUrl,
        jwt: authContext.jwt,
        maxRetries: 3,
        retryDelayMs: 1000
      });

      // Build options based on mode
      const options = mode === DomainMode.PROJECT
        ? { mode: DomainMode.PROJECT as const, projectPrefix: domain }
        : { mode: DomainMode.CUSTOM as const, fqdn: domain };

      const response = await client.checkDomainAvailability(
        subscriptionId,
        systemId,
        appId,
        options
      );

      logger.info('check-domain-availability.api.success', {
        appId,
        mode,
        domain,
        available: response.available,
        accountId: user.accountId,
      });

      return NextResponse.json(response);
    } catch (error: any) {
      logger.error('check-domain-availability.api.error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        status: error?.status,
      });

      return NextResponse.json(
        {
          error: 'Failed to check domain availability',
          details: error instanceof Error ? error.message : String(error)
        },
        { status: error?.status ?? 500 }
      );
    }
  }
);

