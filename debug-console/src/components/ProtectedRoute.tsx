'use client';

import React, { useEffect } from 'react';

import AccessDenied from '@/components/AccessDenied';
import SessionStaleBanner from '@/components/SessionStaleBanner';
import { useAuth } from '@/hooks/useAuth';
import { buildSsoLoginUrl } from '@/lib/sso-host';

const LoadingComponent = () => (
    <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh'
    }}>
        <div>Authenticating...</div>
    </div>
);

export default function ProtectedRoute({
    children
}: {
    children: React.ReactNode;
}) {
    const { isAuthenticated, isLoading, sessionStale, allowed, user } = useAuth();

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!isLoading && !isAuthenticated) {
            const path = window.location.pathname + window.location.search + window.location.hash;
            window.location.href = buildSsoLoginUrl(window.location.host, path);
        }
    }, [isAuthenticated, isLoading]);

    if (isLoading || !isAuthenticated) {
        return <LoadingComponent />;
    }

    // Membership unresolved AND session is stale: SSO rejected the token as
    // too old. Show the re-auth banner over a blank page rather than the
    // access-denied UI (we don't yet know whether the user has access).
    if (allowed === undefined && sessionStale) {
        return <SessionStaleBanner />;
    }

    // Authenticated but membership not yet resolved.
    if (allowed === undefined) {
        return <LoadingComponent />;
    }

    if (!allowed) {
        return <AccessDenied email={user?.email} />;
    }

    return (
        <>
            {sessionStale && <SessionStaleBanner />}
            {children}
        </>
    );
}
