import { NextResponse } from 'next/server';

import { MgmtControlPlaneError } from '@/lib/mgmt-control-plane-adapter';

export const APP_ID_RE = /^[A-Za-z0-9]{8,20}$/i;
export const SUBSCRIPTION_ID_RE = /^[A-Za-z0-9]{4,30}$/i;

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
