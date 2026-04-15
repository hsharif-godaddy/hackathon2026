import { NextRequest, NextResponse } from 'next/server';

import { gdAuthService } from '@/lib/gd-auth-service';
import { logger } from './logger';
import { getRootDomainFromHeaders } from './getRootDomain';

// Track if we've already logged the bypass warning to avoid log spam
let bypassWarningLogged = false;

const AD_MEMBERSHIP_PATH = '/v1/api/jomax/my/ad_membership';

/**
 * Check if auth bypass is allowed
 *
 * Security: BYPASS_AUTH is ignored in production to prevent accidental exposure.
 * Only NODE_ENV=development allows bypass, and we log a warning when it happens.
 * BYPASS_AUTH should be set to 'true' or '1' to bypass auth in test/dev environment.
 */
export function shouldBypassAuth(): { bypass: boolean; reason: string } {
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

interface WithAuthOptions {
    adGroup?: string;
}

/**
 * Validates authentication for API routes
 * Returns authenticated: true if valid, or an error response if not
 */
export async function validateApiAuth(request: NextRequest, options?: WithAuthOptions): Promise<AuthResult> {
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

    if (options?.adGroup) {
        logger.info('api-auth.validateApiAuth.validateAdGroup.begin', { message: 'Validating AD group membership', adGroupToValidate: options.adGroup });
        const adResult = await validateAdGroup(request, token, options.adGroup);
        logger.info('api-auth.validateApiAuth.validateAdGroup.end', { message: 'AD group membership validated', adGroupToValidate: options.adGroup, authenticated: adResult.authenticated });
        if (!adResult.authenticated && adResult.error) {
            logger.error('api-auth.validateApiAuth.validateAdGroup.error', { message: 'Failed to validate AD group membership', adGroupToValidate: options.adGroup, status: adResult.error.status });
            return adResult;
        }
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

async function validateAdGroup(request: NextRequest, token: string, adGroup: string): Promise<AuthResult> {
    try {
        const rootDomain = getRootDomainFromHeaders(request.headers);
        if (!rootDomain) {
            return {
                authenticated: false,
                error: NextResponse.json(
                    { error: 'Forbidden', reason: 'Unable to determine the root domain from the request headers' },
                    { status: 403 }
                )
            };
        }

        const AD_MEMBERSHIP_URL = `https://sso.${rootDomain}${AD_MEMBERSHIP_PATH}`;
        logger.info('api-auth.validateAdGroup.membershipFetch.url', { message: 'AD membership URL', adGroupToValidate: adGroup, url: AD_MEMBERSHIP_URL });
        const response = await fetch(AD_MEMBERSHIP_URL, {
            headers: { Authorization: `sso-jwt ${token}` }
        });
        if (!response.ok) {
            const error: {
                code: number,
                message: string,
                status: number,
                type: string
            } = await response.json();
            logger.error('api-auth.validateAdGroup.membershipFetch.error', { message: 'Failed to verify AD group membership', adGroupToValidate: adGroup, error: JSON.stringify(error) });
            if (error.code === -92) {
                return {
                    authenticated: false,
                    error: NextResponse.json(
                        { error: 'Unauthorized', reason: 'Requires a fresher JWT' },
                        { status: 401 }
                    )
                };
            }

            return {
                authenticated: false,
                error: NextResponse.json(
                    { error: 'Forbidden', reason: 'Failed to verify AD group membership' },
                    { status: 403 }
                )
            };
        }
        logger.info('api-auth.validateAdGroup.membershipFetch.success', { message: 'AD membership fetched successfully', adGroupToValidate: adGroup, url: AD_MEMBERSHIP_URL });

        const body = await response.json();
        const groups: string[] = body?.data?.groups || [];

        const adGroupFound = groups.includes(adGroup);
        logger.info('api-auth.validateAdGroup.groups', { adGroupToValidate: adGroup, adGroupFound, groupCount: groups.length });

        if (!adGroupFound) {
            logger.error('api-auth.validateAdGroup.groups.error', { message: 'User is not a member of required AD group', adGroupToValidate: adGroup });
            return {
                authenticated: false,
                error: NextResponse.json(
                    { error: 'Forbidden', reason: `Not authorized to access this resource` },
                    { status: 403 }
                )
            };
        }

        return { authenticated: true };
    } catch (error) {
        logger.error('api-auth.validateAdGroup.catch.error', { message: 'AD group membership check failed', adGroupToValidate: adGroup}, { error: error as Error });
        return {
            authenticated: false,
            error: NextResponse.json(
                { error: 'Forbidden', reason: 'AD group membership check failed' },
                { status: 403 }
            )
        };
    }
}

/**
 * Higher-order function to wrap API handlers with authentication.
 *
 * The returned function satisfies Next.js 16's strict RouteHandlerConfig
 * validation which requires `context: { params: Promise<...> }` as a
 * required second parameter.
 *
 * Usage for simple routes (context param is accepted but unused):
 *   export const GET = withAuth(async (request, auth) => { ... });
 *
 * Usage for dynamic routes with params:
 *   export const GET = withAuth<{ appId: string }>(async (request, auth, context) => {
 *     const { appId } = await context.params;
 *     ...
 *   });
 *
 * Usage with AD group restriction:
 *   export const GET = withAuth(async (request, auth) => { ... }, { adGroup: 'MyADGroup' });
 */
export function withAuth<P = unknown>(
    handler: (request: NextRequest, auth: AuthResult, context: RouteContext<P>) => Promise<NextResponse | Response>,
    options?: WithAuthOptions
) {
    return async (
        request: NextRequest,
        context: RouteContext<P>
    ): Promise<Response> => {
        const auth = await validateApiAuth(request, options);

        if (!auth.authenticated && auth.error) {
            return auth.error;
        }

        return handler(request, auth, context);
    };
}
