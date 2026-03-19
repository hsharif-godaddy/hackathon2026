import { NextResponse } from 'next/server';

import { OPS_ADMIN } from '@/lib/ad-groups';
import { withAuth } from '@/lib/api-auth';


/**
 * Check if the user is an OPS Admin
 * @param _request - The request object
 * @param auth - The authentication object
 * @returns A JSON response indicating the user is an OPS Admin
 */
export const GET = withAuth(async function checkOpsAdmin(_request, auth) {
    return NextResponse.json({
        opsAdmin: true,
        user: auth.user
    });
}, { adGroup: OPS_ADMIN });
