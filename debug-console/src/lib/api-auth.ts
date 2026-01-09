import { NextRequest, NextResponse } from 'next/server';

import { gdAuthService } from '@/lib/gd-auth-service';

// Track if we've already logged the bypass warning to avoid log spam
let bypassWarningLogged = false;

/**
 * Check if auth bypass is allowed
 *
 * Security: BYPASS_AUTH is ignored in production to prevent accidental exposure.
 * Only NODE_ENV=development allows bypass, and we log a warning when it happens.
 */
function shouldBypassAuth(): { bypass: boolean; reason: string } {
    const nodeEnv = process.env.NODE_ENV;
    const bypassAuth = process.env.BYPASS_AUTH;

    // Never allow bypass in production, regardless of BYPASS_AUTH setting
    if (nodeEnv === 'production') {
        if (bypassAuth === 'true' || bypassAuth === '1') {
            console.error('[SECURITY] BYPASS_AUTH is set but ignored in production environment');
        }
        return { bypass: false, reason: 'production' };
    }

    // In development, allow bypass if explicitly requested or by default
    if (nodeEnv === 'development') {
        return { bypass: true, reason: 'NODE_ENV=development' };
    }

    // For test environment, only allow explicit bypass
    if (bypassAuth === 'true' || bypassAuth === '1') {
        return { bypass: true, reason: 'BYPASS_AUTH flag' };
    }

    return { bypass: false, reason: 'no bypass conditions met' };
}

export interface AuthResult {
    authenticated: boolean;
    user?: {
        shopperId?: string;
        cid?: string;
        email?: string;
    };
    error?: NextResponse;
}

/**
 * Validates authentication for API routes
 * Returns authenticated: true if valid, or an error response if not
 */
export async function validateApiAuth(request: NextRequest): Promise<AuthResult> {
    const bypassCheck = shouldBypassAuth();

    if (bypassCheck.bypass) {
        // Log warning once per process to avoid log spam
        if (!bypassWarningLogged) {
            console.warn(`[SECURITY] Authentication bypass enabled: ${bypassCheck.reason}. This should only occur in development.`);
            bypassWarningLogged = true;
        }

        return {
            authenticated: true,
            user: {
                shopperId: 'local-dev',
                cid: 'local-dev',
                email: 'local-dev@localhost'
            }
        };
    }

    const token = gdAuthService.extractTokenFromRequest(request);

    if (!token) {
        return {
            authenticated: false,
            error: NextResponse.json(
                { error: 'Unauthorized', reason: 'No authentication token found' },
                { status: 401 }
            )
        };
    }

    const result = await gdAuthService.authenticate(token);

    if (!result.valid) {
        return {
            authenticated: false,
            error: NextResponse.json(
                { error: 'Unauthorized', reason: result.reason || 'Authentication failed' },
                { status: 401 }
            )
        };
    }

    return {
        authenticated: true,
        user: {
            shopperId: result.payload?.shopperId,
            cid: result.payload?.cid,
            email: result.payload?.email
        }
    };
}

/**
 * Route context for dynamic routes with params
 */
export interface RouteContext<P = Record<string, string>> {
    params: Promise<P>;
}

/**
 * Higher-order function to wrap API handlers with authentication
 *
 * Usage for simple routes:
 *   export const GET = withAuth(async (request, auth) => { ... });
 *
 * Usage for dynamic routes with params:
 *   export const GET = withAuth<{ appId: string }>(async (request, auth, context) => {
 *     const { appId } = await context.params;
 *     ...
 *   });
 */
export function withAuth<P = void>(
    handler: P extends void
        ? (request: NextRequest, auth: AuthResult) => Promise<NextResponse>
        : (request: NextRequest, auth: AuthResult, context: RouteContext<P>) => Promise<NextResponse>
) {
    return async (
        request: NextRequest,
        context?: RouteContext<P>
    ): Promise<NextResponse> => {
        const auth = await validateApiAuth(request);

        if (!auth.authenticated && auth.error) {
            return auth.error;
        }

        if (context) {
            return (handler as (request: NextRequest, auth: AuthResult, context: RouteContext<P>) => Promise<NextResponse>)(
                request,
                auth,
                context
            );
        }

        return (handler as (request: NextRequest, auth: AuthResult) => Promise<NextResponse>)(request, auth);
    };
}
