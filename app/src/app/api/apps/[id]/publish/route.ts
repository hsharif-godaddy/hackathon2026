import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { handleControlPlaneError } from '@/lib/control-plane/error-handler';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { checkPaywallEligibility } from '@/lib/paywall/core';
import { ServerPaywallProvider } from '@/lib/paywall/server-provider';

/**
 * POST /api/apps/[id]/publish
 *
 * Creates a git archive and triggers deployment via mgmt-airo.
 * The endpoint performs a multi-step workflow:
 * 1. Validate authentication and site ownership
 * 2. Call agents service to create git archive (resolves to full SHA)
 * 3. Notify mgmt-airo to trigger deployment workflow
 * 4. Return combined response with archive and deployment info
 *
 * @param {NextRequest} request - The incoming HTTP request
 * @param {CustomerAuthContext} authContext - Authentication context with user info
 * @param {Object} params - Route parameters
 * @param {string} params.id - The site ID
 *
 * @returns {NextResponse} Response containing commit hash, archive path, and deployment info
 *
 * @example
 * // Request
 * POST /api/apps/abc123/publish
 * {
 *   "commitHash": "a1b2c3d"  // Short or full hash
 * }
 *
 * // Response (success)
 * {
 *   "success": true,
 *   "commitHash": "a1b2c3d4e5f6789012345678901234567890abcd",  // Full SHA
 *   "archive": {
 *     "path": "/publish/dist/a1b2c3d4e5f6789012345678901234567890abcd.tar.gz"
 *   },
 *   "deployment": {
 *     "deploymentId": "uuid-v4",
 *     "statusJobId": "uuid-v4",
 *     "status": "PENDING",
 *     "message": "Publish workflow started"
 *   }
 * }
 */
export const POST = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { user } = authContext;
      const { id: siteId } = await params;

      // Customer must have an account to publish archives
      if (!customerHasAccount(user)) {
        return createCustomerAuthError(
          'You must have an account to publish archives',
          403
        );
      }

      if (!siteId) {
        return NextResponse.json(
          { error: 'Site ID is required' },
          { status: 400 }
        );
      }

      // Parse and validate request body
      const body = await request.json();
      const { commitHash } = body;

      if (!commitHash) {
        return NextResponse.json(
          { error: 'Commit hash is required' },
          { status: 400 }
        );
      }

      // Get site from control plane adapter (handles auth and ownership)
      const adapter = getControlPlaneAdapter();
      const site = await adapter.getSite(siteId, authContext.jwt);

      if (!site) {
        return NextResponse.json(
          { error: 'Site not found' },
          { status: 404 }
        );
      }

      // Check Airo Plus subscription eligibility (server-side enforcement)
      // This prevents bypassing client-side checks via direct API calls
      // Done AFTER ownership verification to prevent abuse
      if (!authContext.jwt) {
        return NextResponse.json(
          { error: 'Authentication token required' },
          { status: 401 }
        );
      }

      const provider = new ServerPaywallProvider(authContext.jwt, user.customerId, request.headers);
      const paywallCheck = await checkPaywallEligibility(siteId, provider);

      if (!paywallCheck.hasAccess) {
        logger.warn('site.publish.paywall-blocked', {
          siteId,
          reason: paywallCheck.reason,
          details: paywallCheck.details,
        });

        // Determine status code based on check results
        // 500 for server errors, 402 for subscription/payment issues
        const statusCode = paywallCheck.reason === 'Unable to verify subscription status' ? 500 : 402;

        return NextResponse.json(
          {
            error: paywallCheck.reason || 'Airo Plus subscription required',
            details: paywallCheck.details,
          },
          { status: statusCode }
        );
      }

      if (!site?.agent_url) {
        throw new Error('Site does not have agent URL');
      }

      logger.info('site.publish.request', {
        siteId,
        commitHash: commitHash.substring(0, 7),
      });

      // Forward the request to the agent service publish endpoint
      const agentUrl = `${site.agent_url}/apps/${siteId}/publish`;

      const response = await agentFetch(agentUrl, {
        siteId,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ commitHash }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error('site.publish.agent-failed', {
          status: response.status,
          statusText: response.statusText,
          error: errorData.error,
          details: errorData.details,
        });
        return NextResponse.json(
          {
            error: errorData.error || 'Failed to publish archive',
            details: errorData.details,
            exitCode: errorData.exitCode,
            status: response.status,
          },
          { status: response.status }
        );
      }

      const data = await response.json();

      logger.info('site.publish.agent-success', {
        siteId,
        commitHash: commitHash.substring(0, 7),
        method: data.method,
        archivePath: data.archive?.path,
      });

      // Step 2: Notify mgmt-airo to trigger deployment (or track for V4)
      // V4 (supervisor): Already published instantly, but notify for tracking
      // V3 (archive): Control plane will deploy the archive
      if (site.subscription_id && site.system_id) {
        logger.info('site.publish.mgmt-airo-notify.begin', {
          siteId,
          subscriptionId: site.subscription_id,
          systemId: site.system_id,
        });

        try {
          // JWT is provided by withCustomerAuth wrapper
          if (!authContext.jwt) {
            throw new Error('Authentication token required');
          }

          const airoClient = new AiroMgmtClient({
            baseUrl: process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net',
            jwt: authContext.jwt,
            maxRetries: 3,
            retryDelayMs: 1000
          });

          const publishResponse = await airoClient.publishApp(
            site.subscription_id,
            site.system_id,
            siteId,
            data.commitHash  // Use full SHA returned from agents
          );

          logger.info('site.publish.mgmt-airo-notify.success', {
            siteId,
            deploymentId: publishResponse.deploymentId,
            statusJobId: publishResponse.statusJobId,
          });

          // Return combined response with deployment info
          return NextResponse.json({
            ...data,
            deployment: {
              deploymentId: publishResponse.deploymentId,
              statusJobId: publishResponse.statusJobId,
              status: publishResponse.status,
              message: publishResponse.message,
            }
          });
        } catch (error) {
          logger.error('site.publish.mgmt-airo-notify.failed', {
            siteId,
            error: error instanceof Error ? error.message : String(error),
          });

          // Return 502 - archive exists but deployment failed
          return NextResponse.json(
            {
              error: 'Archive created but deployment failed to start',
              details: error instanceof Error ? error.message : String(error),
              archive: data.archive,  // Include archive info
            },
            { status: 502 }
          );
        }
      } else {
        // No subscription/system IDs - return success without deployment
        logger.warn('site.publish.mgmt-airo-notify.skipped', {
          siteId,
          reason: 'missing_subscription_system_ids',
          hasSubscriptionId: !!site.subscription_id,
          hasSystemId: !!site.system_id,
        });

        return NextResponse.json(data);
      }
    } catch (error) {
      logger.error('site.publish.error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return handleControlPlaneError(error, 'site.publish');
    }
  }
);
