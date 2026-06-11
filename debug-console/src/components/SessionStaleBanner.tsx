'use client';

import React from 'react';

import { buildSsoLoginUrl } from '@/lib/sso-host';

export default function SessionStaleBanner() {
    const handleSignIn = () => {
        const path = window.location.pathname + window.location.search + window.location.hash;
        window.location.href = buildSsoLoginUrl(window.location.host, path);
    };

    return (
        <div
            role="alert"
            style={{
                position: 'sticky',
                top: 0,
                zIndex: 1000,
                padding: '10px 16px',
                background: '#fff4ce',
                borderBottom: '1px solid #e0c86b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px'
            }}
        >
            <span>Your SSO session has expired. Finish what you&apos;re doing and sign in again to continue.</span>
            <button
                type="button"
                onClick={handleSignIn}
                style={{
                    padding: '6px 12px',
                    background: '#1b1b1b',
                    color: '#fff',
                    border: 0,
                    borderRadius: 4,
                    cursor: 'pointer'
                }}
            >
                Sign in
            </button>
        </div>
    );
}
