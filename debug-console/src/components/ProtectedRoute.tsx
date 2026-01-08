'use client';

import React, { useEffect } from 'react';

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

    useEffect(() => {
        // Skip redirect in local development
        if (isLocalEnv()) {
            return;
        }

        if (!isLoading && !isAuthenticated) {
            let ssoLoginUrl = process.env.NEXT_PUBLIC_SSO_LOGIN_URL ||
                process.env.SSO_LOGIN_URL ||
                'https://sso.test-godaddy.com/login';

            const returnUrl = window.location.href;
            ssoLoginUrl = returnUrl.includes('test') ? 'sso.test-godaddy.com' : 'sso.godaddy.com';
            ssoLoginUrl = `https://${ssoLoginUrl}/login`;
            console.log('ssoLoginUrl', ssoLoginUrl);
            const params = new URLSearchParams({
                app: 'console.airo-builder',
                redirect: returnUrl,
                realm: 'jomax',
            });

            window.location.href = `${ssoLoginUrl}?${params.toString()}`;
        }
    }, [isAuthenticated, isLoading]);

    // In local env, always allow access
    if (isLocalEnv()) {
        return <>{children}</>;
    }

    if (isLoading) {
        return <LoadingComponent />;
    }

    if (!isAuthenticated) {
        return <LoadingComponent />;
    }

    return <>{children}</>;
}
