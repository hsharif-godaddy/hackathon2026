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

function isLocalEnv(): boolean {
    if (typeof window === 'undefined') return false;
    return window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.startsWith('192.168.') ||
        window.location.hostname.startsWith('10.') ||
        process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true';
}

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

        // Skip redirect in local development
        if (isLocalEnv()) {
            return;
        }

        if (!isLoading && !isAuthenticated) {
            const returnUrl = window.location.href;
            const hostname = window.location.hostname;

            // Use env var if set, otherwise detect from hostname
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

    // Show loading on server and until mounted on client to avoid hydration mismatch
    if (!mounted || isLoading) {
        return <LoadingComponent />;
    }

    // In local env, always allow access
    if (isLocalEnv()) {
        return <>{children}</>;
    }

    if (!isAuthenticated) {
        return <LoadingComponent />;
    }

    return <>{children}</>;
}
