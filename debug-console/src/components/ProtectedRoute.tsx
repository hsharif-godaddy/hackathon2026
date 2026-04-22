'use client';

import React, { useEffect } from 'react';

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
    const { isAuthenticated, isLoading, sessionStale } = useAuth();

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!isLoading && !isAuthenticated) {
            window.location.href = buildSsoLoginUrl(window.location.href, window.location.hostname);
        }
    }, [isAuthenticated, isLoading]);

    if (isLoading || !isAuthenticated) {
        return <LoadingComponent />;
    }

    return (
        <>
            {sessionStale && <SessionStaleBanner />}
            {children}
        </>
    );
}
