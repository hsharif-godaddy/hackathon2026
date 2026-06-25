import { NextRequest, NextResponse } from 'next/server';

import { enforceAabMultiUserVentureRelation } from '@/lib/authz-fga/enforce-venture-relation';
import { resolveMultiUserFlag } from '@/lib/authz-fga/multi-user-flag';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { type AiroApiError, type AiroApiErrorV2, AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { mgmtAiro401Response } from '@/lib/mgmt-airo/auth-error';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';
import { normalizeFqdn } from '@/utils/domain';
import { DomainApiErrorCode } from '@/utils/domain-validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sites/[id]/domains/caa-remediation - Consent-gated CAA remediation
 *
 * For a GoDaddy-managed domain whose attach failed with a CAA mismatch, the
 * customer can consent to us additively authorizing a supported issuer on their
 * existing CAA records and re-running the attach. Returns a job ID to track the
 * workflow progress (same shape as modify-domains).
 *
 * @param request - Next.js request object with body containing:
 *   - domainsToCreate: Array of domains to create [{ fqdn: string, primary?: boolean }]
 *   - fqdnsToCreate: Alternative to domainsToCreate, array of fqdn strings
 *   - createCdn: Whether to create CDN for the domains (boolean, optional)
 *   - consent: Must be true (required)
 *   - issuer: Optional issuer override (backend auto-picks otherwise)
 * @param authContext - Customer authentication context
 * @param params - Route parameters with site ID
 * @returns CAA remediation job response with statusJobId
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  let siteId: string | undefined;

  try {
    const { id } = await params;
    siteId = id;

    if (!siteId) {
      return NextResponse.json(
        { code: ApiErrorCode.SITE_ID_REQUIRED, error: 'Site ID is required' },
        { status: 400 }
      );
    }

    if (!authContext.jwt) {
      return NextResponse.json(
        { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
        { status: 401 }
      );
    }

    // Get site to retrieve subscription_id and system_id
    const adapter = getControlPlaneAdapter();
    const multiUserEnabled = await resolveMultiUserFlag(request);
    const site = await adapter.getSite(siteId, authContext.jwt, undefined, { multiUserEnabled });

    if (!site) {
      return NextResponse.json(
        { code: ApiErrorCode.SITE_NOT_FOUND, error: 'Site not found' },
        { status: 404 }
      );
    }

    const domainsDeny = await enforceAabMultiUserVentureRelation({
      request,
      siteId,
      customerId: authContext.user.customerId,
      siteInfo: site,
      relation: AUTHZ_FGA_RELATIONS.canManageDomains,
      forbiddenMessage: 'You do not have permission to manage domains for this app.',
    });
    if (domainsDeny) {
      return domainsDeny;
    }

    if (!site.subscription_id || !site.system_id) {
      logger.error('sites.domains.caa-remediation.missing-ids', {
        message: 'Site missing subscription_id or system_id',
        siteId,
      });
      return NextResponse.json(
        { code: ApiErrorCode.SITE_CONFIG_INCOMPLETE, error: 'Site configuration incomplete' },
        { status: 400 }
      );
    }

    // Parse request body. Coerce array fields defensively so a null/non-array
    // value yields a 400 below rather than throwing a 500 on .length/.map.
    const body = await request.json();
    const domainsToCreate = Array.isArray(body?.domainsToCreate) ? body.domainsToCreate : [];
    const fqdnsToCreate = Array.isArray(body?.fqdnsToCreate) ? body.fqdnsToCreate : [];
    const createCdn = body?.createCdn ?? false;
    const consent = body?.consent;
    const issuer = body?.issuer;

    // Consent is mandatory — the backend rejects a non-true consent with 400.
    if (consent !== true) {
      return NextResponse.json(
        { code: DomainApiErrorCode.CONSENT_REQUIRED, error: 'Consent is required for CAA remediation' },
        { status: 400 }
      );
    }

    // At least one domain must be supplied (matching the original failed attach).
    if (domainsToCreate.length === 0 && fqdnsToCreate.length === 0) {
      return NextResponse.json(
        { code: DomainApiErrorCode.DOMAIN_OPERATION_REQUIRED, error: 'Must specify at least one domain' },
        { status: 400 }
      );
    }

    // Validate domain objects
    for (const domain of domainsToCreate) {
      if (!domain.fqdn || typeof domain.fqdn !== 'string') {
        return NextResponse.json(
          { code: DomainApiErrorCode.INVALID_DOMAIN_FORMAT, error: 'Invalid domain format: fqdn is required' },
          { status: 400 }
        );
      }
    }

    for (const fqdn of fqdnsToCreate) {
      if (!fqdn || typeof fqdn !== 'string') {
        return NextResponse.json(
          { code: DomainApiErrorCode.INVALID_DOMAIN_FORMAT, error: 'Invalid domain format: fqdn is required' },
          { status: 400 }
        );
      }
    }

    logger.info('sites.domains.caa-remediation.start', {
      message: 'Starting CAA remediation',
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      domainsToCreateCount: domainsToCreate.length,
      fqdnsToCreateCount: fqdnsToCreate.length,
      createCdn,
      hasIssuer: !!issuer,
    });

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });
    const response = await client.caaRemediation(
      site.subscription_id,
      site.system_id,
      siteId,
      {
        ...(domainsToCreate.length > 0 && {
          domainsToCreate: domainsToCreate.map((domain: { fqdn: string; primary?: boolean }) => ({
            ...domain,
            fqdn: normalizeFqdn(domain.fqdn),
          })),
        }),
        ...(fqdnsToCreate.length > 0 && {
          fqdnsToCreate: fqdnsToCreate.map((fqdn: string) => normalizeFqdn(fqdn)),
        }),
        createCdn,
        consent: true,
        ...(typeof issuer === 'string' && issuer.length > 0 && { issuer }),
      },
    );

    logger.info('sites.domains.caa-remediation.success', {
      message: 'CAA remediation job started',
      siteId,
      statusJobId: response.statusJobId,
      status: response.status,
    });

    return NextResponse.json(response);

  } catch (error) {
    const authResponse = mgmtAiro401Response(error, 'sites.domains.caa-remediation.hbi-expired', { siteId });
    if (authResponse) return authResponse;

    logger.error('sites.domains.caa-remediation.error', {
      message: 'Failed to run CAA remediation',
      siteId,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorBody: error instanceof AiroHttpError ? JSON.stringify(error) : undefined,
    });

    let errorMessage: string | AiroApiError | AiroApiErrorV2 = 'Unknown error';

    if (error instanceof AiroHttpError) {
      errorMessage = error.body;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      { code: DomainApiErrorCode.CAA_REMEDIATION_FAILED, error: 'Failed to run CAA remediation', details: errorMessage },
      { status: error instanceof AiroHttpError ? error.status : 500 }
    );
  }
}, { level: 3 });
