'use client';

import { useEffect, useState } from 'react';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user?: {
    shopperId?: string;
    cid?: string;
    email?: string;
  };
}

// Module-level cache prevents duplicate /api/auth/validate calls when
// multiple consumers mount simultaneously. The TTL guards against showing
// stale `isAuthenticated: true` state after the SSO cookie expires
// mid-session — server routes already gate correctly, but without a TTL
// the UI would keep claiming we're signed in until a hard refresh.
const CACHE_TTL_MS = 60 * 60 * 1000;
let cachedAuthState: AuthState | null = null;
let cachedAt = 0;
let authCheckPromise: Promise<AuthState> | null = null;

function isCacheFresh(): boolean {
  return cachedAuthState !== null && Date.now() - cachedAt < CACHE_TTL_MS;
}

async function checkAuthOnce(): Promise<AuthState> {
  if (isCacheFresh()) return cachedAuthState as AuthState;
  if (authCheckPromise) return authCheckPromise;

  authCheckPromise = fetch('/api/auth/validate')
    .then(async response => {
      if (response.ok) {
        const data = await response.json();
        cachedAuthState = {
          isAuthenticated: data.valid,
          isLoading: false,
          user: data.payload ? {
            shopperId: data.payload.shopperId,
            cid: data.payload.cid,
            email: data.payload.email
          } : undefined
        };
      } else {
        cachedAuthState = { isAuthenticated: false, isLoading: false };
      }
      cachedAt = Date.now();
      return cachedAuthState;
    })
    .catch(() => {
      cachedAuthState = { isAuthenticated: false, isLoading: false };
      cachedAt = Date.now();
      return cachedAuthState;
    })
    .finally(() => {
      authCheckPromise = null;
    });

  return authCheckPromise;
}

export function useAuth(): AuthState {
  // Seed from the module cache when present so remounted consumers don't
  // flicker through `isLoading: true` after the first successful auth check.
  const [authState, setAuthState] = useState<AuthState>(() =>
    isCacheFresh() ? (cachedAuthState as AuthState) : { isAuthenticated: false, isLoading: true }
  );

  useEffect(() => {
    let cancelled = false;
    checkAuthOnce().then(next => {
      if (!cancelled) setAuthState(next);
    });
    return () => { cancelled = true; };
  }, []);

  return authState;
}
