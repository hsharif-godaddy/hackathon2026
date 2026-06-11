import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { APP_ID_RE, SUBSCRIPTION_ID_RE, validateId, handleMgmtError } from '@/lib/mgmt-helpers';

export const dynamic = 'force-dynamic';

const VALID_VARIANTS = ['preview', 'publish'] as const;
type DeployVariant = typeof VALID_VARIANTS[number];

export const POST = withAuth<{ appId: string }>(async function deployApp(
    request: NextRequest,
    _auth,
    context
) {
    const { appId } = await context.params;

    let subscriptionId = '';
    let systemId = '';
    let variant = '';

    try {
        const body = await request.json();
        subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId : '';
        systemId = typeof body.systemId === 'string' ? body.systemId : '';
        variant = typeof body.variant === 'string' ? body.variant : '';
    } catch { /* empty ids fail validation below */ }

    const invalid =
        validateId(appId, 'appId', APP_ID_RE) ??
        validateId(subscriptionId, 'subscriptionId', SUBSCRIPTION_ID_RE) ??
        validateId(systemId, 'systemId', APP_ID_RE);
    if (invalid) return invalid;

    if (!(VALID_VARIANTS as readonly string[]).includes(variant)) {
        return NextResponse.json(
            { error: `variant must be one of: ${VALID_VARIANTS.join(', ')}` },
            { status: 400 }
        );
    }

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.deployApp(appId, {
            subscriptionId,
            systemId,
            variant: variant as DeployVariant,
        }));
    } catch (error) {
        // AbortSignal.timeout in mgmt-sso-client surfaces as TimeoutError.
        // The deploy may still complete asynchronously upstream — say so, or
        // operators read this as a hard failure and retry into a second deploy.
        if (error instanceof Error && error.name === 'TimeoutError') {
            return NextResponse.json(
                { error: 'mgmt-airo did not respond within 30s. The deploy may still complete asynchronously — check the lifecycle timestamps before retrying.' },
                { status: 504 }
            );
        }
        return handleMgmtError(error, 'trigger app deploy', { appId, variant });
    }
});
