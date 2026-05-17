import { createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { DEBUG_CONSOLE_ALLOWED_GROUPS } from '@/lib/ad-groups';
import { gdAuthService } from '@/lib/gd-auth-service';
import { logger } from './logger';
import { getRootDomainFromHeaders } from './getRootDomain';

const AD_MEMBERSHIP_PATH = '/v1/api/jomax/my/ad_membership';

// AD-group membership cache: SSO returns the same set for the duration of a
// JWT, so re-fetching on every API call is pure overhead — a single Dashboard
// load was firing ~20 redundant calls. Cache by SHA-256(token) so we never
// hold raw tokens in memory; TTL is short enough that revoked group access
// takes effect within a minute.
const AD_GROUPS_CACHE_TTL_MS = 60_000;
const AD_GROUPS_CACHE_MAX_ENTRIES = 200;
interface AdGroupsCacheEntry {
    groups: string[];
    expiresAt: number;
}
const adGroupsCache = new Map<string, AdGroupsCacheEntry>();
// Coalesce concurrent requests for the same token so 12 parallel API routes
// in one page load fire one upstream call, not 12.
const adGroupsInFlight = new Map<string, Promise<AdMembershipFetchResult>>();

function tokenCacheKey(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function getCachedAdGroups(key: string): string[] | undefined {
    const hit = adGroupsCache.get(key);
    if (!hit) return undefined;
    if (Date.now() >= hit.expiresAt) {
        adGroupsCache.delete(key);
        return undefined;
    }
    return hit.groups;
}

function setCachedAdGroups(key: string, groups: string[]): void {
    // Naive LRU-by-insertion-order: when full, drop the oldest entry. Maps
    // preserve insertion order, so deleting the first key is O(1).
    if (adGroupsCache.size >= AD_GROUPS_CACHE_MAX_ENTRIES) {
        const oldest = adGroupsCache.keys().next().value;
        if (oldest !== undefined) adGroupsCache.delete(oldest);
    }
    adGroupsCache.set(key, { groups, expiresAt: Date.now() + AD_GROUPS_CACHE_TTL_MS });
}

/**
 * Test-only: clear the cache + in-flight maps so each test sees a clean
 * slate. Without this, tests that share a JWT token would all hit the cache
 * after the first test runs. Not exported via the public surface — intended
 * to be called from `beforeEach` in api-auth.test.ts.
 */
export function __clearAdGroupsCacheForTests(): void {
    adGroupsCache.clear();
    adGroupsInFlight.clear();
}

export interface AuthUser {
    shopperId?: string;
    cid?: string;
    email?: string;
}

/**
 * Discriminated union: when `authenticated` is true the caller has a valid
 * session; when false `error` is always present so consumers cannot
 * accidentally fall through to the protected handler with no error response.
 */
export type AuthResult =
    | { authenticated: true; user?: AuthUser }
    | { authenticated: false; error: NextResponse };

/**
 * AD-group requirement modes. Mutually exclusive: a route picks at most one.
 *   - `{}`                           default allowlist (DEBUG_CONSOLE_ALLOWED_GROUPS)
 *   - `{ adGroup: 'X' }`             stricter, EXCLUSIVE to that group
 *   - `{ adGroupAny: [...] }`        custom any-of allowlist
 *   - `{ skipMembership: true }`     no membership check (auth-only)
 */
type WithAuthOptions =
    | { adGroup?: never; adGroupAny?: never; skipMembership?: never }
    | { adGroup: string; adGroupAny?: never; skipMembership?: never }
    | { adGroup?: never; adGroupAny: readonly string[]; skipMembership?: never }
    | { adGroup?: never; adGroupAny?: never; skipMembership: true };

/**
 * Validates authentication for API routes
 * Returns authenticated: true if valid, or an error response if not
 */
export async function validateApiAuth(request: NextRequest, options?: WithAuthOptions): Promise<AuthResult> {
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

    const result = await gdAuthService.authenticate(token, request);

    if (!result.valid) {
        return {
            authenticated: false,
            error: NextResponse.json(
                { error: 'Unauthorized', reason: result.reason || 'Authentication failed' },
                { status: 401 }
            )
        };
    }

    if (!options?.skipMembership) {
        const required = options?.adGroup
            ? [options.adGroup]
            : (options?.adGroupAny ?? DEBUG_CONSOLE_ALLOWED_GROUPS);
        const adResult = await validateAnyAdGroup(request, token, required);
        if (!adResult.authenticated) {
            logger.warn('api-auth.validateApiAuth.adGroup.denied', {
                required,
                status: adResult.error.status,
            });
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

type AdMembershipFetchResult =
    | { ok: true; groups: string[] }
    | { ok: false; status: number; needsFresherJwt?: boolean; reason: string };

/**
 * Fetches the caller's AD group membership from SSO, with an in-memory TTL
 * cache and in-flight coalescing.
 *
 * Reusable across withAuth and the /api/auth/membership endpoint. Without
 * the cache, every API request fired its own SSO round-trip — a single page
 * load could trigger 20+ identical calls.
 *
 * Failures are NOT cached: a transient SSO outage shouldn't keep returning
 * "forbidden" for 60 seconds after it recovers.
 */
export async function fetchUserAdGroups(request: NextRequest, token: string): Promise<AdMembershipFetchResult> {
    const rootDomain = getRootDomainFromHeaders(request.headers);
    if (!rootDomain) {
        return { ok: false, status: 403, reason: 'Unable to determine the root domain from the request headers' };
    }

    const cacheKey = tokenCacheKey(token);
    const cached = getCachedAdGroups(cacheKey);
    if (cached) {
        return { ok: true, groups: cached };
    }

    // Coalesce: if another request for the same token is already fetching,
    // await its result instead of firing another SSO call.
    const inFlight = adGroupsInFlight.get(cacheKey);
    if (inFlight) {
        return inFlight;
    }

    const url = `https://sso.${rootDomain}${AD_MEMBERSHIP_PATH}`;
    const promise = (async (): Promise<AdMembershipFetchResult> => {
        try {
            const response = await fetch(url, { headers: { Authorization: `sso-jwt ${token}` } });
            if (!response.ok) {
                const errorBody: { code?: number } = await response.json().catch(() => ({}));
                logger.error('api-auth.fetchUserAdGroups.error', { url, status: response.status, code: errorBody.code });
                if (errorBody.code === -92) {
                    return { ok: false, status: 401, needsFresherJwt: true, reason: 'Requires a fresher JWT' };
                }
                return { ok: false, status: 403, reason: 'Failed to verify AD group membership' };
            }
            const body = await response.json();
            const groups: string[] = Array.isArray(body?.data?.groups) ? body.data.groups : [];
            setCachedAdGroups(cacheKey, groups);
            logger.info('api-auth.fetchUserAdGroups.success', { groupCount: groups.length, cached: false });
            return { ok: true, groups };
        } catch (error) {
            logger.error('api-auth.fetchUserAdGroups.catch', {}, { error: error as Error });
            return { ok: false, status: 403, reason: 'AD group membership check failed' };
        } finally {
            adGroupsInFlight.delete(cacheKey);
        }
    })();
    adGroupsInFlight.set(cacheKey, promise);
    return promise;
}

/**
 * Returns the subset of `required` that the caller is a member of, matched
 * case-insensitively. Empty array means no match.
 */
export function intersectGroupsCaseInsensitive(userGroups: readonly string[], required: readonly string[]): string[] {
    const userSet = new Set(userGroups.map(function lower(g) { return g.toLowerCase(); }));
    return required.filter(function isMember(group) { return userSet.has(group.toLowerCase()); });
}

async function validateAnyAdGroup(request: NextRequest, token: string, required: readonly string[]): Promise<AuthResult> {
    const fetched = await fetchUserAdGroups(request, token);
    if (!fetched.ok) {
        return {
            authenticated: false,
            error: NextResponse.json(
                { error: fetched.status === 401 ? 'Unauthorized' : 'Forbidden', reason: fetched.reason },
                { status: fetched.status }
            ),
        };
    }

    const matched = intersectGroupsCaseInsensitive(fetched.groups, required);
    if (matched.length === 0) {
        logger.warn('api-auth.validateAnyAdGroup.denied', { required, userGroupCount: fetched.groups.length });
        return {
            authenticated: false,
            error: NextResponse.json(
                { error: 'Forbidden', reason: 'Not authorized to access this resource' },
                { status: 403 }
            ),
        };
    }

    return { authenticated: true };
}

/**
 * Higher-order function to wrap API handlers with authentication.
 *
 * The returned function satisfies Next.js 16's strict RouteHandlerConfig
 * validation which requires `context: { params: Promise<...> }` as a
 * required second parameter.
 *
 * By default every wrapped route requires:
 *   1. A valid SSO token, AND
 *   2. Membership in any one of DEBUG_CONSOLE_ALLOWED_GROUPS.
 *
 * Override the default with one of:
 *   - { adGroup: 'X' }   -> stricter, EXCLUSIVE membership in this group
 *                          (e.g. credit-pack uses { adGroup: OPS_ADMIN }
 *                          even though OPS_ADMIN is in the default allowlist).
 *   - { adGroupAny: [...] } -> different any-of allowlist (rarely needed).
 *   - { skipMembership: true } -> auth-only, no membership check
 *                                 (use sparingly; only for endpoints that
 *                                 must be reachable to render the
 *                                 access-denied UI itself).
 *
 * AD-group matching is case-insensitive throughout.
 *
 * Examples:
 *   export const GET = withAuth(async (request, auth) => { ... });
 *   export const GET = withAuth<{ appId: string }>(async (request, auth, context) => { ... });
 *   export const GET = withAuth(async (request, auth) => { ... }, { adGroup: OPS_ADMIN });
 *   export const GET = withAuth(async (request, auth) => { ... }, { skipMembership: true });
 */
/**
 * Narrowed `AuthResult` passed to a `withAuth` handler. Always authenticated
 * by construction; `user` may still be undefined when the JWT lacked claims.
 */
export type AuthenticatedRequest = { authenticated: true; user?: AuthUser };

export function withAuth<P = unknown>(
    handler: (request: NextRequest, auth: AuthenticatedRequest, context: RouteContext<P>) => Promise<NextResponse | Response>,
    options?: WithAuthOptions
) {
    return async (
        request: NextRequest,
        context: RouteContext<P>
    ): Promise<Response> => {
        const auth = await validateApiAuth(request, options);

        if (!auth.authenticated) {
            return auth.error;
        }

        return handler(request, auth, context);
    };
}
