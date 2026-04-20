import { NextResponse } from 'next/server';

import { MgmtControlPlaneError } from '@/lib/mgmt-types';

export const APP_ID_RE = /^[A-Za-z0-9]{8,20}$/i;
export const SUBSCRIPTION_ID_RE = /^[A-Za-z0-9]{4,30}$/i;
export const CUSTOMER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Shopper IDs in the wild come in two shapes:
//   - legacy 3-letter alpha aliases (e.g. "abc")
//   - numeric 4-12 digit IDs (the common case)
// This regex is the canonical contract — proxy routes that forward shopper IDs
// upstream MUST validate against it before doing anything else.
export const SHOPPER_ID_RE = /^([a-zA-Z]{3}|[0-9]{4,12})$/;

export function validateId(value: string, name: string, re: RegExp): NextResponse | null {
    if (!re.test(value)) {
        return NextResponse.json({ error: `Invalid ${name}` }, { status: 400 });
    }
    return null;
}

export function handleMgmtError(error: unknown, context: string, meta: Record<string, unknown>): NextResponse {
    if (error instanceof MgmtControlPlaneError) {
        return NextResponse.json(
            { error: error.message, details: error.responseJson ?? error.responseBody },
            { status: error.statusCode }
        );
    }
    console.error('[mgmt] error', {
        context,
        ...meta,
        error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: `Failed to ${context}` }, { status: 502 });
}
