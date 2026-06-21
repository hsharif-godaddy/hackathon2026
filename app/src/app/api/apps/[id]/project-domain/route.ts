import { NextRequest, NextResponse } from 'next/server';

import { enforceAabMultiUserVentureRelation } from '@/lib/authz-fga/enforce-venture-relation';
import { resolveMultiUserFlag } from '@/lib/authz-fga/multi-user-flag';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from '@/lib/customer-auth';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { mgmtAiro401Response } from '@/lib/mgmt-airo/auth-error';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/apps/[id]/project-domain - Update app project domain
 *
 * Updates the app's project domain prefix (subdomain) via mgmt-airo API
 *
 * @param request - Next.js request object with body: { projectPrefix: string }
 * @param authContext - Customer authentication context
 * @param params - Route context with params: { id: string }
 * @returns Success response with updated project prefix
 *
 * @example
 * // Request
 * PUT /api/apps/abc123/project-domain
 * {
 *   "projectPrefix": "my-new-subdomain"
 * }
 *
 * // Response (success)
 * {
 *   "success": true,
 *   "message": "Project domain updated successfully",
 *   "projectPrefix": "my-new-subdomain"
 * }
 *
 * // Response (error - 409 conflict)
 * {
 *   "error": "Project domain is already in use"
 * }
 */
export const PUT = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ id: string }> }
  ): Promise<NextResponse> => {
    try {
      const { id: appId } = await params;
      const { user } = authContext;

      // Customer must have an account to update project domains
      if (!customerHasAccount(user)) {
        return createCustomerAuthError(
          'You must have an account to update project domains',
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

      // Parse and validate request body
      const body = await request.json();
      const { projectPrefix } = body;

      if (!projectPrefix || typeof projectPrefix !== 'string') {
        return NextResponse.json(
          { error: 'Invalid project prefix provided' },
          { status: 400 }
        );
      }

      // Validate project prefix format (alphanumeric, hyphens)
      const domainRegex = /^[a-z0-9-]+$/i;
      if (!domainRegex.test(projectPrefix)) {
        return NextResponse.json(
          { error: 'Project prefix must contain only letters, numbers, and hyphens' },
          { status: 400 }
        );
      }

      logger.info('update-project-domain.api.start', {
        appId,
        projectPrefix,
        accountId: user.accountId,
      });

      // Get site from control plane adapter to get subscription/system IDs
      const adapter = getControlPlaneAdapter();
      const multiUserEnabled = await resolveMultiUserFlag(request);
      const site = await adapter.getSite(appId, authContext.jwt, undefined, { multiUserEnabled });

      if (!site) {
        return NextResponse.json(
          { error: 'Site not found' },
          { status: 404 }
        );
      }

      const projectDomainDeny = await enforceAabMultiUserVentureRelation({
        request,
        siteId: appId,
        customerId: user.customerId,
        siteInfo: site,
        relation: AUTHZ_FGA_RELATIONS.canManageDomains,
        forbiddenMessage: 'You do not have permission to update the project domain for this app.',
      });
      if (projectDomainDeny) {
        return projectDomainDeny;
      }

      // Check if site has subscription and system IDs (required for mgmt-airo)
      if (!site.subscription_id || !site.system_id) {
        logger.warn('update-project-domain.api.no-ids', {
          appId,
          hasSubscriptionId: !!site.subscription_id,
          hasSystemId: !!site.system_id,
        });
        return NextResponse.json(
          { error: 'Site does not have required configuration' },
          { status: 400 }
        );
      }

      // Create mgmt-airo client and update project domain
      const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
      const client = new AiroMgmtClient({
        baseUrl,
        jwt: authContext.jwt,
        maxRetries: 3,
        retryDelayMs: 1000
      });

      const response = await client.updateProjectDomain(
        site.subscription_id,
        site.system_id,
        appId,
        { projectPrefix }
      );

      logger.info('update-project-domain.api.success', {
        appId,
        projectPrefix,
        accountId: user.accountId,
      });

      return NextResponse.json(response);

    } catch (error: any) {
      const authResponse = mgmtAiro401Response(error, 'update-project-domain.api.hbi-expired');
      if (authResponse) return authResponse;

      logger.error('update-project-domain.api.error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        status: error?.status,
      });

      // Handle 409 conflict (domain already in use)
      if (error?.status === 409) {
        return NextResponse.json(
          {
            error: 'Project domain is already in use',
            details: error instanceof Error ? error.message : String(error)
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          error: 'Failed to update project domain',
          details: error instanceof Error ? error.message : String(error)
        },
        { status: error?.status ?? 500 }
      );
    }
  }
);

