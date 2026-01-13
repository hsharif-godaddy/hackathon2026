/**
 * BetterAuth Client + Components
 *
 * BetterAuth handles session context internally via cookies and the useSession hook.
 * No explicit React context provider is needed - the authClient manages session state.
 */

import { createAuthClient } from 'better-auth/react';
import { ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

// Auth client - baseURL empty means relative to current origin
export const authClient = createAuthClient({ baseURL: '' });
export const { signIn, signUp, signOut, useSession } = authClient;

// Alias for useSession (common naming convention)
export const useAuth = useSession;

/**
 * SessionProvider - Wrapper for compatibility with common auth patterns.
 *
 * BetterAuth manages session state internally through cookies and the useSession hook,
 * so no React context is needed. This component is provided for API compatibility
 * with apps that expect a provider wrapper pattern (e.g., migrating from NextAuth).
 *
 * You can safely wrap your app with this, but it's optional.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// Alias for SessionProvider (common naming convention in auth libraries)
export const AuthProvider = SessionProvider;

// Session timeout for loading state (30 seconds)
const SESSION_TIMEOUT_MS = 30000;

// ProtectedRoute component with timeout handling
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data: session, isPending, error } = useSession();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!isPending) return;

    const timeout = setTimeout(() => setTimedOut(true), SESSION_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [isPending]);

  if (timedOut) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-gray-600">Session check timed out. Please try again.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error || !session) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/**
 * LogoutButton - Button to sign out the user
 *
 * Handles the sign-out process and redirects to login page.
 * Can be customized with className prop.
 */
export function LogoutButton({
  className = '',
  children = 'Logout',
}: {
  className?: string;
  children?: ReactNode;
}) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogout() {
    setIsLoading(true);
    try {
      await signOut();
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout failed:', error);
      setIsLoading(false);
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={isLoading}
      className={className || 'px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-50'}
    >
      {isLoading ? 'Logging out...' : children}
    </button>
  );
}
