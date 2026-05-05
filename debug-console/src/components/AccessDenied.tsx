'use client';

import type { CSSProperties } from 'react';

interface AccessDeniedProps {
    email?: string;
}

export default function AccessDenied({ email }: AccessDeniedProps) {
    return (
        <div style={pageStyle}>
            <div style={cardStyle}>
                <h1 style={titleStyle}>Access Denied</h1>
                <p style={bodyStyle}>
                    You do not have permission to access the debug console.
                </p>
                {email && (
                    <p style={mutedStyle}>
                        Signed in as <code style={codeStyle}>{email}</code>
                    </p>
                )}
                <p style={supportStyle}>
                    Contact <span style={channelStyle}>#airo-ai-builder-support</span> to request access.
                </p>
            </div>
        </div>
    );
}

const pageStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    padding: '2rem',
    backgroundColor: '#f5f5f5',
};

const cardStyle: CSSProperties = {
    backgroundColor: 'white',
    padding: '2rem 2.5rem',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    maxWidth: '480px',
    width: '100%',
    textAlign: 'center',
};

const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: 600,
    color: '#dc2626',
};

const bodyStyle: CSSProperties = {
    margin: '0.75rem 0 0',
    color: '#1f2937',
    fontSize: '0.95rem',
};

const mutedStyle: CSSProperties = {
    margin: '0.75rem 0 0',
    color: '#6b7280',
    fontSize: '0.85rem',
};

const supportStyle: CSSProperties = {
    margin: '1.25rem 0 0',
    color: '#374151',
    fontSize: '0.9rem',
    lineHeight: 1.5,
};

const channelStyle: CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontWeight: 600,
    color: '#1f2937',
};

const codeStyle: CSSProperties = {
    backgroundColor: '#f3f4f6',
    padding: '2px 6px',
    borderRadius: '4px',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: '0.85rem',
};
