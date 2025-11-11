import { NextRequest, NextResponse } from 'next/server';
import { withCustomerAuth, type CustomerAuthContext } from '@/lib/customer-auth';
import { DomainsClient } from '@/lib/domains';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/domains/attach - Attach a provider's service to a user's domain
 *
 * Attaches a provider's service to a domain. Supports flags for dryrun and force operations.
 *
 * @param request - Next.js request object with body containing:
 *   - domainName: Domain name to attach
 *   - providerId: Provider identifier
 *   - serviceId: Service identifier
 *   - host: Host configuration
 *   - dryrun: Check if parameters are valid without performing operation
 *   - force: Perform operation even if there are conflicting records
 *   - dc/internal/manual/saml: Service-specific configuration objects
 * @param authContext - Customer authentication context
 * @returns Attach response
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const customerId = authContext.user.customerId;

    if (!customerId) {
      logger.error('domains.attach.missing-customer-id', {
        message: 'Customer ID not available in auth context'
      });
      return NextResponse.json(
        { error: 'Customer ID not available' },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { domainName, ip, dryrun = false, force = true } = body;

    if (!domainName) {
      return NextResponse.json(
        { error: 'Domain name is required' },
        { status: 400 }
      );
    }

    if (!ip) {
      return NextResponse.json(
        { error: 'IP address is required' },
        { status: 400 }
      );
    }

    const baseUrl = 'https://domain-attach.api.godaddy.com';
    const client = new DomainsClient({ baseUrl, jwt: authContext.jwt });

    const attachConfig = {
      dryrun,
      force,
      host: '',
      params: { IP: ip },
      providerId: 'godaddy',
      serviceId: 'airo'
    };

    logger.info('domains.attach.start', {
      message: 'Attaching domain to service',
      customerId,
      domainName,
      dryrun,
      force
    });

    const response = await client.attachDomain(customerId, domainName, attachConfig);

    logger.info('domains.attach.success', {
      message: 'Domain attached successfully',
      customerId,
      domainName
    });

    return NextResponse.json(response);

  } catch (error) {
    logger.error('domains.attach.error', {
      message: 'Failed to attach domain',
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { error: 'Failed to attach domain' },
      { status: error?.status ?? 500 }
    );
  }
});
