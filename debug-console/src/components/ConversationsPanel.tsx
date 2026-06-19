'use client';

import React, { useEffect, useState } from 'react';

import AIAgentPanel from '@/components/AIAgentPanel';
import LangfuseEbPanel from '@/components/LangfuseEbPanel';

export type ConversationsSource = 'eb' | 'agent';

interface Props {
    globalAppId: string;
    refreshKey: number;
    onRefresh?: () => void;
    source: ConversationsSource;
    onSourceChange: (source: ConversationsSource) => void;
}

export default function ConversationsPanel({
    globalAppId,
    refreshKey,
    onRefresh,
    source,
    onSourceChange,
}: Props) {
    const disabled = !globalAppId;

    // Each sub-panel is mounted lazily on first selection, then kept alive via
    // display:none so the user keeps panel state when toggling. Avoids the
    // hidden Agent panel firing health/memory/conversation-list fetches the
    // first time the operator lands on Conversations with the default Langfuse
    // view.
    const [visitedSources, setVisitedSources] = useState<Set<ConversationsSource>>(
        () => new Set<ConversationsSource>([source]),
    );
    useEffect(() => {
        setVisitedSources((prev) => (prev.has(source) ? prev : new Set(prev).add(source)));
    }, [source]);

    return (
        <div>
            <div style={toggleRowStyle}>
                <div style={toggleGroupStyle}>
                    <ToggleButton
                        active={source === 'eb'}
                        disabled={disabled}
                        onClick={() => onSourceChange('eb')}
                        label="Langfuse"
                    />
                    <ToggleButton
                        active={source === 'agent'}
                        disabled={disabled}
                        onClick={() => onSourceChange('agent')}
                        label="Agent"
                    />
                </div>
            </div>

            {visitedSources.has('eb') && (
                <div style={{ display: source === 'eb' ? 'block' : 'none' }}>
                    <LangfuseEbPanel
                        globalAppId={globalAppId}
                        refreshKey={refreshKey}
                        onRefresh={onRefresh}
                    />
                </div>
            )}

            {visitedSources.has('agent') && (
                <div style={{ display: source === 'agent' ? 'block' : 'none' }}>
                    <AIAgentPanel
                        globalAppId={globalAppId}
                        refreshKey={refreshKey}
                        onRefresh={onRefresh}
                    />
                </div>
            )}
        </div>
    );
}

function ToggleButton({ active, disabled, onClick, label }: {
    active: boolean;
    disabled: boolean;
    onClick: () => void;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            style={{
                ...toggleButtonStyle,
                backgroundColor: active ? '#ffffff' : 'transparent',
                color: active ? '#3b82f6' : '#6b7280',
                fontWeight: active ? 600 : 500,
                boxShadow: active ? '0 1px 2px rgba(0, 0, 0, 0.08)' : 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
            }}
        >
            {label}
        </button>
    );
}

const toggleRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    padding: '0 0.25rem 0.75rem',
};

const toggleGroupStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.125rem',
    padding: '0.125rem',
    backgroundColor: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
};

const toggleButtonStyle: React.CSSProperties = {
    padding: '0.375rem 0.875rem',
    border: 'none',
    borderRadius: '4px',
    fontSize: '0.8rem',
    transition: 'all 0.15s ease',
};
