'use client';

import React from 'react';

import { useAuth } from '@/hooks/useAuth';

export default function UserMenu() {
    const { isAuthenticated, isLoading, user } = useAuth();

    if (isLoading || !isAuthenticated) return null;

    const alias = user?.shopperId || user?.email || 'Account';

    return (
        <span
            title={alias}
            style={{
                height: '40px',
                padding: '0 0.9375rem',
                borderRadius: '5px',
                border: '1px solid #d1d5db',
                backgroundColor: 'white',
                color: '#111827',
                fontWeight: 600,
                fontSize: '1.016rem',
                fontFamily: 'monospace',
                display: 'inline-flex',
                alignItems: 'center',
                maxWidth: '200px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }}
        >
            {alias}
        </span>
    );
}
