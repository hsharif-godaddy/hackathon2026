'use client';

import { useEffect } from 'react';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { isReturningUser, setReturningUserCookie } from '@/lib/returningUser';

/**
 * Sets the returning-user cookie whenever an authenticated user lands on any page.
 *
 * Rendered at root layout level. No API call needed — auth presence alone is the
 * signal that this browser belongs to someone with an account.
 */
export default function ReturningUserCookieSync() {
  const { isAuthenticated, isLoading } = useAuthContext();

  useEffect(() => {
    if (!isAuthenticated || isLoading) return;
    if (!isReturningUser()) {
      setReturningUserCookie();
    }
  }, [isAuthenticated, isLoading]);

  return null;
}
