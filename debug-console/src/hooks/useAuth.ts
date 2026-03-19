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

function isLocalEnv(): boolean {
  if (typeof window === 'undefined') {return false;}
  return window.location.hostname === 'localhost' ||
         window.location.hostname === '127.0.0.1' ||
         window.location.hostname.startsWith('192.168.') ||
         window.location.hostname.startsWith('10.') ||
         process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true';
}

// Module-level cache to prevent duplicate auth checks
let cachedAuthState: AuthState | null = null;
let authCheckPromise: Promise<AuthState> | null = null;

async function checkAuthOnce(): Promise<AuthState> {
  if (cachedAuthState) {return cachedAuthState;}
  if (authCheckPromise) {return authCheckPromise;}

  // Bypass auth in local development
  if (isLocalEnv()) {
    cachedAuthState = {
      isAuthenticated: true,
      isLoading: false,
      user: { shopperId: 'local-dev', cid: 'local-dev', email: 'local-dev@localhost' }
    };
    return cachedAuthState;
  }

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
      return cachedAuthState;
    })
    .catch(() => {
      cachedAuthState = { isAuthenticated: false, isLoading: false };
      return cachedAuthState;
    });

  return authCheckPromise;
}

// Get initial state synchronously for local env
function getInitialState(): AuthState {
  if (typeof window !== 'undefined' && isLocalEnv()) {
    return {
      isAuthenticated: true,
      isLoading: false,
      user: { shopperId: 'local-dev', cid: 'local-dev', email: 'local-dev@localhost' }
    };
  }
  return { isAuthenticated: false, isLoading: true };
}

export function useAuth(): AuthState {
  const [authState, setAuthState] = useState<AuthState>(getInitialState);

  useEffect(() => {
    // Skip if already authenticated (local env)
    if (authState.isAuthenticated && !authState.isLoading) {return;}

    checkAuthOnce().then(setAuthState);
  }, [authState.isAuthenticated, authState.isLoading]);

  return authState;
}
