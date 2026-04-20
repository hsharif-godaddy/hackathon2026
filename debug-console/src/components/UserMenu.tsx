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
                padding: '0.375rem 0.75rem',
                borderRadius: '4px',
                border: '1px solid #d1d5db',
                backgroundColor: 'white',
                color: '#111827',
                fontWeight: 600,
                fontSize: '0.813rem',
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
