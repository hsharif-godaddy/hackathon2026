import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { DOMAIN_RE, validateId, handleMgmtError } from '@/lib/mgmt-helpers';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ fqdn: string }>(async function getAppByDomain(
    _request: NextRequest,
    _auth,
    context
) {
    const { fqdn } = await context.params;

    const invalid = validateId(fqdn, 'fqdn', DOMAIN_RE);
    if (invalid) return invalid;

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.getAppByDomain(fqdn));
    } catch (error) {
        return handleMgmtError(error, 'resolve domain to app', { fqdn });
    }
});
