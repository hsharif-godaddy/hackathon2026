'use client';

import React, { useState } from 'react';

interface APMTrace {
    timestamp: string;
    spanName?: string;
    duration?: number;
    raw: Record<string, unknown>;
}

type DetailTab = 'overview' | 'prompt' | 'response' | 'tools' | 'metrics' | 'raw';

interface ConversationLogDetailPanelProps {
    trace: APMTrace;
    onClose: () => void;
    onPrevious?: () => void;
    onNext?: () => void;
    hasPrevious?: boolean;
    hasNext?: boolean;
}

interface ToolInfo {
    name?: string;
    type?: string;
    description?: string;
    inputSchema?: {
        properties?: Record<string, unknown>;
        required?: string[];
    };
}

function formatFullTimestamp(timestamp: string): string {
    try {
        return new Date(timestamp).toLocaleString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3,
            hour12: false
        });
    } catch {
        return timestamp;
    }
}

function parseAIPromptTools(toolsStr: string | undefined): ToolInfo[] | null {
    if (!toolsStr) return null;
    try {
        const parsed = JSON.parse(toolsStr);
        if (Array.isArray(parsed)) {
            return parsed;
        }
        return null;
    } catch {
        return null;
    }
}

function mapOperationName(name?: string): string {
    if (!name) return 'Unknown Operation';
    const mapping: Record<string, string> = {
        'ai.streamText': 'AI Stream Text',
        'ai.generateText': 'AI Generate Text',
        'ai.toolCall': 'Tool Call'
    };
    return mapping[name] || name;
}

export default function ConversationLogDetailPanel({
    trace,
    onClose,
    onPrevious,
    onNext,
    hasPrevious = false,
    hasNext = false
}: ConversationLogDetailPanelProps) {
    const [activeTab, setActiveTab] = useState<DetailTab>('overview');
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(trace.raw, null, 2));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            console.error('Failed to copy to clipboard');
        }
    };

    const labels = (trace.raw?.labels as Record<string, unknown>) || {};
    const numericLabels = (trace.raw?.numeric_labels as Record<string, number>) || {};
    const aiPromptTools = parseAIPromptTools(labels.ai_prompt_tools as string);
    const hasTools = Boolean(aiPromptTools && aiPromptTools.length > 0);
    const hasMetrics = Object.keys(numericLabels).length > 0;

    const tabs: { id: DetailTab; label: string; visible: boolean }[] = ([
        { id: 'overview' as const, label: 'Overview', visible: true },
        { id: 'prompt' as const, label: 'Prompt', visible: !!labels.ai_prompt },
        { id: 'response' as const, label: 'Response', visible: !!labels.ai_response_text },
        { id: 'tools' as const, label: `Tools (${aiPromptTools?.length || 0})`, visible: hasTools },
        { id: 'metrics' as const, label: 'Metrics', visible: hasMetrics },
        { id: 'raw' as const, label: 'Raw JSON', visible: true }
    ] as const).filter(tab => tab.visible);

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            backgroundColor: 'white',
            borderLeft: '1px solid #e5e7eb'
        }}>
            {/* Header */}
            <div style={{
                padding: '0.75rem 1rem',
                borderBottom: '1px solid #e5e7eb',
                backgroundColor: '#f9fafb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        backgroundColor: '#dbeafe',
                        color: '#1e40af',
                        border: '1px solid #93c5fd'
                    }}>
                        {mapOperationName((labels.operation_name as string) || trace.spanName)}
                    </span>
                    <span style={{
                        fontSize: '0.75rem',
                        color: '#6b7280',
                        fontFamily: 'monospace'
                    }}>
                        {formatFullTimestamp(trace.timestamp)}
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                        onClick={onPrevious}
                        disabled={!hasPrevious}
                        title="Previous trace (↑)"
                        style={{
                            padding: '0.25rem 0.5rem',
                            backgroundColor: hasPrevious ? '#f3f4f6' : '#f9fafb',
                            border: '1px solid #d1d5db',
                            borderRadius: '4px',
                            cursor: hasPrevious ? 'pointer' : 'not-allowed',
                            fontSize: '0.75rem',
                            color: hasPrevious ? '#374151' : '#9ca3af',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        ↑
                    </button>
                    <button
                        onClick={onNext}
                        disabled={!hasNext}
                        title="Next trace (↓)"
                        style={{
                            padding: '0.25rem 0.5rem',
                            backgroundColor: hasNext ? '#f3f4f6' : '#f9fafb',
                            border: '1px solid #d1d5db',
                            borderRadius: '4px',
                            cursor: hasNext ? 'pointer' : 'not-allowed',
                            fontSize: '0.75rem',
                            color: hasNext ? '#374151' : '#9ca3af',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        ↓
                    </button>
                    <button
                        onClick={onClose}
                        title="Close (Esc)"
                        style={{
                            padding: '0.25rem 0.5rem',
                            backgroundColor: '#f3f4f6',
                            border: '1px solid #d1d5db',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            color: '#374151',
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div style={{
                display: 'flex',
                borderBottom: '1px solid #e5e7eb',
                backgroundColor: '#fafafa',
                flexShrink: 0,
                overflowX: 'auto'
            }}>
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            padding: '0.5rem 1rem',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            border: 'none',
                            borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
                            backgroundColor: 'transparent',
                            color: activeTab === tab.id ? '#3b82f6' : '#6b7280',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{
                flex: 1,
                overflow: 'auto',
                padding: '1rem'
            }}>
                {activeTab === 'overview' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <MetadataField label="Operation" value={mapOperationName((labels.operation_name as string) || trace.spanName)} />
                        <MetadataField label="Timestamp" value={formatFullTimestamp(trace.timestamp)} mono />
                        {trace.duration && (
                            <MetadataField label="Duration" value={`${trace.duration.toFixed(2)} ms`} mono />
                        )}
                        {typeof labels.ai_model_id === 'string' && (
                            <MetadataField label="Model" value={labels.ai_model_id} mono />
                        )}
                        {typeof labels.gen_ai_request_model === 'string' && (
                            <MetadataField label="Model" value={labels.gen_ai_request_model} mono />
                        )}
                        {typeof labels.ai_model_provider === 'string' && (
                            <MetadataField label="Provider" value={labels.ai_model_provider} />
                        )}
                        {typeof labels.gen_ai_system === 'string' && (
                            <MetadataField label="System" value={labels.gen_ai_system} />
                        )}
                        {numericLabels.ai_usage_totalTokens !== undefined && (
                            <MetadataField label="Total Tokens" value={numericLabels.ai_usage_totalTokens.toLocaleString()} mono />
                        )}
                        {numericLabels.ai_response_msToFinish !== undefined && (
                            <MetadataField label="Response Time" value={`${numericLabels.ai_response_msToFinish.toFixed(0)} ms`} mono />
                        )}
                    </div>
                )}

                {activeTab === 'prompt' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '0.5rem'
                        }}>
                            <div style={{
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                color: '#6b7280'
                            }}>
                                AI Prompt
                            </div>
                            <button
                                onClick={() => navigator.clipboard.writeText(labels.ai_prompt as string || '')}
                                style={{
                                    fontSize: '0.65rem',
                                    padding: '0.25rem 0.5rem',
                                    backgroundColor: '#f3f4f6',
                                    border: '1px solid #d1d5db',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    color: '#374151'
                                }}
                            >
                                Copy
                            </button>
                        </div>
                        <pre style={{
                            fontSize: '0.8rem',
                            padding: '0.75rem',
                            borderRadius: '6px',
                            border: '1px solid #e5e7eb',
                            backgroundColor: '#f9fafb',
                            overflowX: 'auto',
                            margin: 0,
                            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word'
                        }}>
                            {labels.ai_prompt as string || 'No prompt available'}
                        </pre>
                    </div>
                )}

                {activeTab === 'response' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '0.5rem'
                        }}>
                            <div style={{
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                color: '#6b7280'
                            }}>
                                AI Response
                            </div>
                            <button
                                onClick={() => navigator.clipboard.writeText(labels.ai_response_text as string || '')}
                                style={{
                                    fontSize: '0.65rem',
                                    padding: '0.25rem 0.5rem',
                                    backgroundColor: '#f3f4f6',
                                    border: '1px solid #d1d5db',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    color: '#374151'
                                }}
                            >
                                Copy
                            </button>
                        </div>
                        <pre style={{
                            fontSize: '0.8rem',
                            padding: '0.75rem',
                            borderRadius: '6px',
                            border: '1px solid #e5e7eb',
                            backgroundColor: '#f9fafb',
                            overflowX: 'auto',
                            margin: 0,
                            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word'
                        }}>
                            {labels.ai_response_text as string || 'No response available'}
                        </pre>
                    </div>
                )}

                {activeTab === 'tools' && aiPromptTools && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {aiPromptTools.map((tool, toolIndex) => (
                            <div
                                key={toolIndex}
                                style={{
                                    padding: '0.75rem',
                                    backgroundColor: '#f9fafb',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '6px'
                                }}
                            >
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    marginBottom: '0.5rem'
                                }}>
                                    <span style={{
                                        fontSize: '0.875rem',
                                        fontWeight: 600,
                                        color: '#1a1a1a',
                                        fontFamily: 'monospace'
                                    }}>
                                        {tool.name || 'Unknown Tool'}
                                    </span>
                                    {tool.type && (
                                        <span style={{
                                            fontSize: '0.65rem',
                                            padding: '0.125rem 0.375rem',
                                            backgroundColor: '#e5e7eb',
                                            borderRadius: '4px',
                                            color: '#6b7280'
                                        }}>
                                            {tool.type}
                                        </span>
                                    )}
                                </div>
                                {tool.description && (
                                    <div style={{
                                        fontSize: '0.75rem',
                                        color: '#374151',
                                        marginBottom: '0.5rem',
                                        lineHeight: '1.5'
                                    }}>
                                        {tool.description}
                                    </div>
                                )}
                                {tool.inputSchema?.properties && (
                                    <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>
                                        <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                                            Parameters:
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                                            {Object.keys(tool.inputSchema.properties).map((paramName) => {
                                                const param = tool.inputSchema!.properties![paramName] as Record<string, unknown>;
                                                const isRequired = tool.inputSchema?.required?.includes(paramName);
                                                return (
                                                    <span
                                                        key={paramName}
                                                        style={{
                                                            fontSize: '0.65rem',
                                                            padding: '0.125rem 0.375rem',
                                                            backgroundColor: isRequired ? '#fee2e2' : '#f3f4f6',
                                                            border: `1px solid ${isRequired ? '#fca5a5' : '#d1d5db'}`,
                                                            borderRadius: '4px',
                                                            color: '#374151',
                                                            fontFamily: 'monospace'
                                                        }}
                                                    >
                                                        {paramName}
                                                        {typeof param.type === 'string' && `: ${param.type}`}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'metrics' && (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '0.75rem'
                    }}>
                        {(numericLabels.ai_usage_inputTokens !== undefined ||
                            numericLabels.gen_ai_usage_input_tokens !== undefined) && (
                                <MetricCard
                                    label="Input Tokens"
                                    value={(numericLabels.ai_usage_inputTokens ||
                                        numericLabels.gen_ai_usage_input_tokens || 0).toLocaleString()}
                                />
                            )}
                        {(numericLabels.ai_usage_outputTokens !== undefined ||
                            numericLabels.gen_ai_usage_output_tokens !== undefined) && (
                                <MetricCard
                                    label="Output Tokens"
                                    value={(numericLabels.ai_usage_outputTokens ||
                                        numericLabels.gen_ai_usage_output_tokens || 0).toLocaleString()}
                                />
                            )}
                        {numericLabels.ai_usage_totalTokens !== undefined && (
                            <MetricCard
                                label="Total Tokens"
                                value={numericLabels.ai_usage_totalTokens.toLocaleString()}
                            />
                        )}
                        {numericLabels.ai_usage_cachedInputTokens !== undefined &&
                            numericLabels.ai_usage_cachedInputTokens > 0 && (
                                <MetricCard
                                    label="Cached Tokens"
                                    value={numericLabels.ai_usage_cachedInputTokens.toLocaleString()}
                                    color="#10b981"
                                />
                            )}
                        {numericLabels.ai_response_msToFinish !== undefined && (
                            <MetricCard
                                label="Total Time"
                                value={`${numericLabels.ai_response_msToFinish.toFixed(0)} ms`}
                            />
                        )}
                        {numericLabels.ai_response_msToFirstChunk !== undefined && (
                            <MetricCard
                                label="Time to First Chunk"
                                value={`${numericLabels.ai_response_msToFirstChunk.toFixed(0)} ms`}
                            />
                        )}
                        {numericLabels.ai_response_avgOutputTokensPerSecond !== undefined && (
                            <MetricCard
                                label="Output Speed"
                                value={`${numericLabels.ai_response_avgOutputTokensPerSecond.toFixed(1)} tok/s`}
                            />
                        )}
                        {numericLabels.ai_settings_temperature !== undefined && (
                            <MetricCard
                                label="Temperature"
                                value={String(numericLabels.ai_settings_temperature)}
                            />
                        )}
                        {(numericLabels.ai_settings_maxOutputTokens !== undefined ||
                            numericLabels.gen_ai_request_max_tokens !== undefined) && (
                                <MetricCard
                                    label="Max Tokens"
                                    value={(numericLabels.ai_settings_maxOutputTokens ||
                                        numericLabels.gen_ai_request_max_tokens || 0).toLocaleString()}
                                />
                            )}
                        {numericLabels.ai_settings_maxRetries !== undefined && (
                            <MetricCard
                                label="Max Retries"
                                value={String(numericLabels.ai_settings_maxRetries)}
                            />
                        )}
                    </div>
                )}

                {activeTab === 'raw' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'flex-end'
                        }}>
                            <button
                                onClick={handleCopy}
                                style={{
                                    fontSize: '0.7rem',
                                    padding: '0.25rem 0.75rem',
                                    backgroundColor: copied ? '#dcfce7' : '#f3f4f6',
                                    border: `1px solid ${copied ? '#86efac' : '#d1d5db'}`,
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    color: copied ? '#166534' : '#374151',
                                    fontWeight: 500,
                                    transition: 'all 0.15s'
                                }}
                            >
                                {copied ? '✓ Copied!' : 'Copy JSON'}
                            </button>
                        </div>
                        <pre style={{
                            fontSize: '0.7rem',
                            padding: '0.75rem',
                            borderRadius: '6px',
                            border: '1px solid #e5e7eb',
                            backgroundColor: '#1f2937',
                            color: '#f3f4f6',
                            overflowX: 'auto',
                            margin: 0,
                            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                            lineHeight: 1.4,
                            flex: 1
                        }}>
                            {JSON.stringify(trace.raw, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}

function MetadataField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div style={{
            padding: '0.5rem 0.75rem',
            backgroundColor: '#f9fafb',
            borderRadius: '6px',
            border: '1px solid #e5e7eb'
        }}>
            <div style={{
                fontSize: '0.6rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                marginBottom: '0.15rem',
                color: '#9ca3af',
                letterSpacing: '0.05em'
            }}>
                {label}
            </div>
            <div style={{
                fontSize: '0.8rem',
                color: '#1f2937',
                fontFamily: mono ? 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' : 'inherit',
                wordBreak: 'break-all'
            }}>
                {value}
            </div>
        </div>
    );
}

function MetricCard({ label, value, color = '#1a1a1a' }: { label: string; value: string; color?: string }) {
    return (
        <div style={{
            padding: '0.75rem',
            backgroundColor: '#f9fafb',
            borderRadius: '6px',
            border: '1px solid #e5e7eb'
        }}>
            <div style={{
                fontSize: '0.65rem',
                color: '#6b7280',
                marginBottom: '0.25rem'
            }}>
                {label}
            </div>
            <div style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: color,
                fontFamily: 'monospace'
            }}>
                {value}
            </div>
        </div>
    );
}
