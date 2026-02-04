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
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' ||
         window.location.hostname === '127.0.0.1' ||
         window.location.hostname.startsWith('192.168.') ||
         window.location.hostname.startsWith('10.') ||
         process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true';
}

export function useAuth(): AuthState {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true
  });

  useEffect(() => {
    async function checkAuth() {
      // Bypass auth in local development
      if (isLocalEnv()) {
        setAuthState({
          isAuthenticated: true,
          isLoading: false,
          user: {
            shopperId: 'local-dev',
            cid: 'local-dev',
            email: 'local-dev@localhost'
          }
        });
        return;
      }

      try {
        const response = await fetch('/api/auth/validate');
        if (response.ok) {
          const data = await response.json();
          setAuthState({
            isAuthenticated: data.valid,
            isLoading: false,
            user: data.payload ? {
              shopperId: data.payload.shopperId,
              cid: data.payload.cid,
              email: data.payload.email
            } : undefined
          });
        } else {
          setAuthState({
            isAuthenticated: false,
            isLoading: false
          });
        }
      } catch (_error) {
        setAuthState({
          isAuthenticated: false,
          isLoading: false
        });
      }
    }

    checkAuth();
  }, []);

  return authState;
}
