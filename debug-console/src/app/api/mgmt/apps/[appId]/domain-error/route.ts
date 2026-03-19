import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { APP_ID_RE, SUBSCRIPTION_ID_RE, validateId, handleMgmtError } from '@/lib/mgmt-helpers';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ appId: string }>(async function getDomainError(
    request: NextRequest,
    _auth,
    context
) {
    const { appId } = await context.params;

    const invalid = validateId(appId, 'appId', APP_ID_RE);
    if (invalid) {return invalid;}

    const { searchParams } = request.nextUrl;
    const fqdn = searchParams.get('fqdn');
    const subscriptionId = searchParams.get('subscriptionId');
    const systemId = searchParams.get('systemId');

    if (!fqdn) {return NextResponse.json({ error: 'Missing fqdn' }, { status: 400 });}
    if (!subscriptionId) {return NextResponse.json({ error: 'Missing subscriptionId' }, { status: 400 });}
    if (!systemId) {return NextResponse.json({ error: 'Missing systemId' }, { status: 400 });}

    if (!/^[a-zA-Z0-9][a-zA-Z0-9\-.]{0,253}$/.test(fqdn)) {
        return NextResponse.json({ error: 'Invalid fqdn' }, { status: 400 });
    }

    const subInvalid = validateId(subscriptionId, 'subscriptionId', SUBSCRIPTION_ID_RE);
    if (subInvalid) {return subInvalid;}

    const sysInvalid = validateId(systemId, 'systemId', APP_ID_RE);
    if (sysInvalid) {return sysInvalid;}

    try {
        return NextResponse.json(
            await mgmtControlPlaneAdapter.getDomainError(appId, fqdn, { subscriptionId, systemId })
        );
    } catch (error) {
        return handleMgmtError(error, 'fetch domain error', { appId, fqdn });
    }
});
