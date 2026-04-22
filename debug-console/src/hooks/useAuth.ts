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
            // sessionStale is owned by refreshSession (SSO heartbeat); preserve
            // it here. /api/auth/validate runs gd-auth at level 0 and does not
            // contact SSO, so a locally-valid token can still be rejected by SSO.
            setState({
                isAuthenticated: Boolean(data.valid),
                isLoading: false,
                sessionStale: data.valid ? currentState.sessionStale : false,
                user
            });
            if (data.valid) startRefreshTimer();
            else stopRefreshTimer();
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
