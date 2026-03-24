import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { CUSTOMER_ID_RE, validateId, handleMgmtError } from '@/lib/mgmt-helpers';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ customerId: string }>(async function getCustomerApps(
    _request: NextRequest,
    _auth,
    context
) {
    const { customerId } = await context.params;

    const invalid = validateId(customerId, 'customerId', CUSTOMER_ID_RE);
    if (invalid) return invalid;

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.getCustomerApps(customerId));
    } catch (error) {
        return handleMgmtError(error, 'fetch customer apps', { customerId });
    }
});
