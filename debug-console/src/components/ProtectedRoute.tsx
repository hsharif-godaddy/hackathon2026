'use client';

import React, { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';

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
    const { isAuthenticated, isLoading } = useAuth();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!mounted) return;

        if (!isLoading && !isAuthenticated) {
            const returnUrl = window.location.href;
            const hostname = window.location.hostname;

            let ssoLoginUrl = process.env.NEXT_PUBLIC_SSO_LOGIN_URL;
            if (!ssoLoginUrl) {
                const isTestEnv = hostname.includes('test-') || hostname.includes('.test.');
                const ssoDomain = isTestEnv ? 'sso.test-godaddy.com' : 'sso.godaddy.com';
                ssoLoginUrl = `https://${ssoDomain}/login`;
            }

            const params = new URLSearchParams({
                app: 'console.airo-builder',
                redirect: returnUrl,
                realm: 'jomax',
            });

            window.location.href = `${ssoLoginUrl}?${params.toString()}`;
        }
    }, [isAuthenticated, isLoading, mounted]);

    if (!mounted || isLoading) {
        return <LoadingComponent />;
    }

    if (!isAuthenticated) {
        return <LoadingComponent />;
    }

    return <>{children}</>;
}
