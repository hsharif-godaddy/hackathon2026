'use client';

import { useEffect, useSyncExternalStore } from 'react';

interface AuthUser {
    shopperId?: string;
    cid?: string;
    email?: string;
}

interface AuthState {
    isAuthenticated: boolean;
    isLoading: boolean;
    sessionStale: boolean;
    user?: AuthUser;
    /**
     * Membership check result. `undefined` while loading or if the
     * caller is unauthenticated. `true` once the membership endpoint
     * confirms the user is in at least one allowed AD group.
     */
    allowed?: boolean;
    matchedGroups?: string[];
    allowedGroups?: string[];
}

// Refresh cadence and cache TTL are intentionally coupled: the module cache
// should never outlive one refresh cycle, or we'd show "signed in" UI against
// a cookie the server has already rejected. Keep these in lockstep.
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const CACHE_TTL_MS = REFRESH_INTERVAL_MS;

const INITIAL_STATE: AuthState = {
    isAuthenticated: false,
    isLoading: true,
    sessionStale: false
};

let currentState: AuthState = INITIAL_STATE;
let cachedAt = 0;
let inflightValidate: Promise<AuthState> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function isCacheFresh(): boolean {
    return cachedAt > 0 && Date.now() - cachedAt < CACHE_TTL_MS;
}

function setState(next: AuthState) {
    currentState = next;
    cachedAt = Date.now();
    listeners.forEach(fn => fn());
}

function startRefreshTimer() {
    if (typeof window === 'undefined' || refreshTimer) return;
    refreshTimer = setInterval(refreshSession, REFRESH_INTERVAL_MS);
}

function stopRefreshTimer() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

interface MembershipResult {
    allowed?: boolean;
    matchedGroups?: string[];
    allowedGroups?: string[];
    user?: AuthUser;
    /**
     * True when the membership endpoint returned 401 — the SSO token is
     * stale and needs a fresher JWT. Caller should surface re-auth
     * (sessionStale=true, allowed=undefined) rather than the access-denied
     * UI, which is reserved for "authenticated but not in any allowed
     * group".
     */
    sessionStale?: boolean;
}

async function fetchMembership(): Promise<MembershipResult> {
    try {
        const res = await fetch('/api/auth/membership');
        if (res.status === 401) {
            // SSO rejected the token (typically code -92, "needs fresher
            // JWT"). Leave `allowed` undefined so ProtectedRoute does not
            // render Access Denied; show the re-auth banner instead.
            return { sessionStale: true };
        }
        if (!res.ok) {
            return { allowed: false };
        }
        const data = await res.json();
        return {
            allowed: Boolean(data.allowed),
            matchedGroups: Array.isArray(data.matchedGroups) ? data.matchedGroups : [],
            allowedGroups: Array.isArray(data.allowedGroups) ? data.allowedGroups : [],
            user: data.user ? {
                shopperId: data.user.shopperId,
                cid: data.user.cid,
                email: data.user.email,
            } : undefined,
        };
    } catch {
        // Treat network errors as denial. The user can refresh the page; the
        // alternative (granting access on transient failures) is unsafe.
        return { allowed: false };
    }
}

async function validateSession(): Promise<AuthState> {
    if (isCacheFresh()) return currentState;
    if (inflightValidate) return inflightValidate;

    inflightValidate = fetch('/api/auth/validate')
        .then(async response => {
            if (!response.ok) {
                setState({ isAuthenticated: false, isLoading: false, sessionStale: false });
                stopRefreshTimer();
                return currentState;
            }
            const data = await response.json();
            const user: AuthUser | undefined = data.payload
                ? {
                    shopperId: data.payload.shopperId,
                    cid: data.payload.cid,
                    email: data.payload.email
                }
                : undefined;

            if (!data.valid) {
                setState({
                    isAuthenticated: false,
                    isLoading: false,
                    sessionStale: false,
                    user
                });
                stopRefreshTimer();
                return currentState;
            }

            const membership = await fetchMembership();
            // sessionStale is owned by refreshSession (SSO heartbeat) but
            // /api/auth/membership also contacts SSO and may discover the
            // token is too old. Honor either signal: a 401 from membership
            // forces sessionStale=true so the user re-auths instead of
            // seeing the Access Denied screen.
            setState({
                isAuthenticated: true,
                isLoading: false,
                sessionStale: currentState.sessionStale || Boolean(membership.sessionStale),
                user: membership.user ?? user,
                allowed: membership.allowed,
                matchedGroups: membership.matchedGroups,
                allowedGroups: membership.allowedGroups,
            });
            startRefreshTimer();
            return currentState;
        })
        .catch(() => {
            setState({ isAuthenticated: false, isLoading: false, sessionStale: false });
            stopRefreshTimer();
            return currentState;
        })
        .finally(() => {
            inflightValidate = null;
        });

    return inflightValidate;
}

async function refreshSession(): Promise<void> {
    if (!currentState.isAuthenticated) return;

    let res: Response;
    try {
        res = await fetch('/api/auth/refresh', { method: 'POST' });
    } catch {
        // Network errors are transient; don't prompt for re-auth. Next tick
        // will retry.
        return;
    }

    if (res.ok) {
        // Bump cache timestamp so new mounts don't re-hit /api/auth/validate
        // for 15 min just because state didn't change.
        cachedAt = Date.now();
        if (currentState.sessionStale) {
            setState({ ...currentState, sessionStale: false });
        }
        return;
    }

    // Only an explicit 401 from /api/auth/refresh means SSO rejected the
    // token. Any other status (502 from flaky SSO, 500, etc.) is transient —
    // keep polling so we recover if SSO comes back.
    if (res.status === 401) {
        stopRefreshTimer();
        if (!currentState.sessionStale) {
            setState({ ...currentState, sessionStale: true });
        }
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSnapshot(): AuthState {
    return currentState;
}

function getServerSnapshot(): AuthState {
    return INITIAL_STATE;
}

export function useAuth(): AuthState {
    const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    useEffect(() => {
        if (!isCacheFresh() && !inflightValidate) {
            validateSession();
        }
    }, []);

    return state;
}
