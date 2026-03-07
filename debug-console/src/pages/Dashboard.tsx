'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useState } from 'react';

import AppDetailsPanel from '@/components/AppDetailsPanel';
import LangfusePanel from '@/components/LangfusePanel';
import LogsPanel, { type LogSource } from '@/components/LogsPanel';
import PublishEventsPanel from '@/components/PublishEventsPanel';

const TIME_RANGES = [
  { label: 'Last 1 hour', value: '1h' },
  { label: 'Last 6 hours', value: '6h' },
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 14 days', value: '14d' },
] as const;

const VALID_TIME_RANGE_VALUES = TIME_RANGES.map(r => r.value) as readonly string[];

interface ErrorSummary {
  total: number;
  last24Hours: number;
  errorGroups: Array<{
    message: string;
    count: number;
    lastSeen?: string;
    event?: string;
  }>;
}

interface AppContext {
  appId: string;
  metadata: {
    lastActivity?: string;
    subscriptionId?: string;
  };
  errorSummary: ErrorSummary;
}

interface SpendDay {
  date: string;
  spend: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  requests: number;
}

interface LlmSpendData {
  subscriptionId: string;
  grantUserIds: string[];
  totalSpend: number;
  totalTokens: number;
  totalRequests: number;
  dailySpend: SpendDay[];
  docCount: number;
}

type TabId = 'details' | 'summary' | 'conversation' | 'agent-logs' | 'ui-logs' | 'hosting-logs' | 'publish' | 'llm-spend';

function formatTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch {
    return timestamp;
  }
}

export default function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [appId, setAppId] = useState('');
  const [submittedAppId, setSubmittedAppId] = useState('');
  const [timeRange, setTimeRange] = useState('24h');
  const [activeTab, setActiveTab] = useState<TabId>('details');
  const [sources, setSources] = useState<LogSource[]>([]);
  const [context, setContext] = useState<AppContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Record<string, Array<{ timestamp: string; message: string; event?: string; service?: string; raw: Record<string, unknown> }>>>({});
  const [llmSpend, setLlmSpend] = useState<LlmSpendData | null>(null);
  const [llmSpendLoading, setLlmSpendLoading] = useState(false);
  const [llmSpendError, setLlmSpendError] = useState<string | null>(null);

  // Refresh keys to trigger re-fetches for each tab
  const [refreshKeys, setRefreshKeys] = useState({
    details: 0,
    summary: 0,
    conversation: 0,
    'agent-logs': 0,
    'ui-logs': 0,
    'hosting-logs': 0,
    'publish': 0,
    'llm-spend': 0,
  });

  const handleRefreshTab = useCallback((tabId: TabId) => {
    setRefreshKeys(prev => ({ ...prev, [tabId]: prev[tabId] + 1 }));
  }, []);

  // Initialize from URL params on mount
  useEffect(() => {
    const urlAppId = searchParams?.get('appId');
    const urlTab = searchParams?.get('tab') as TabId | null;
    const urlTimeRange = searchParams?.get('timeRange');
    if (urlAppId) {
      setAppId(urlAppId);
      setSubmittedAppId(urlAppId);
    }
    if (urlTab && ['details', 'summary', 'conversation', 'agent-logs', 'ui-logs', 'hosting-logs', 'publish', 'llm-spend'].includes(urlTab)) {
      setActiveTab(urlTab);
    }
    if (urlTimeRange && VALID_TIME_RANGE_VALUES.includes(urlTimeRange)) {
      setTimeRange(urlTimeRange);
    }
  }, [searchParams]);

  // Fetch log sources on mount
  useEffect(() => {
    fetch('/api/log-sources')
      .then(res => res.ok ? res.json() : { sources: [] })
      .then(data => setSources(data.sources || []))
      .catch(() => setSources([]));
  }, []);

  // Fetch app context when appId is submitted
  const fetchContext = useCallback(async () => {
    if (!submittedAppId) {
      setContext(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = `/api/app-context?appId=${encodeURIComponent(submittedAppId)}&timeRange=${timeRange}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch app details');
      }

      const data = await response.json();
      setContext(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch app details');
    } finally {
      setLoading(false);
    }
  }, [submittedAppId, timeRange]);

  useEffect(() => {
    fetchContext();
  }, [fetchContext]);

  // Re-fetch summary when refresh key changes
  useEffect(() => {
    if (refreshKeys.summary > 0) {
      fetchContext();
    }
  }, [refreshKeys.summary]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch LLM spend when subscriptionId becomes available.
  // First fetches grants to collect all llmBudgetUserIds (airo-builder:grant:* / airo-builder:sid:*),
  // then queries llm-spend with both the billing SID and those user IDs.
  useEffect(() => {
    const billingSid = context?.metadata?.subscriptionId;
    if (!billingSid) {
      setLlmSpend(null);
      return;
    }

    const controller = new AbortController();
    setLlmSpendLoading(true);
    setLlmSpendError(null);

    // Extract raw subscription ID (strip 'airo-build:sid:' prefix) to call the mgmt grants API
    const BILLING_PREFIX = 'airo-build:sid:';
    const rawSubId = billingSid.startsWith(BILLING_PREFIX) ? billingSid.slice(BILLING_PREFIX.length) : null;

    const grantsPromise = rawSubId
      ? fetch(`/api/mgmt/subscriptions/${encodeURIComponent(rawSubId)}/grants`, { signal: controller.signal })
          .then(res => res.ok ? res.json() : null)
          .catch((err) => {
            if (err.name === 'AbortError') throw err;
            return null;
          })
      : Promise.resolve(null);

    grantsPromise
      .then((grantsData: { grants?: Array<{ isAvailable: boolean; llmBudgetUserId?: string }> } | null) => {
        const grantUserIds: string[] = grantsData?.grants
          ?.filter(g => g.isAvailable && g.llmBudgetUserId)
          ?.map(g => g.llmBudgetUserId as string) ?? [];

        const params = new URLSearchParams({ subscriptionId: billingSid });
        for (const uid of grantUserIds) {
          params.append('grantUserId', uid);
        }
        return fetch(`/api/llm-spend?${params}`, { signal: controller.signal });
      })
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch LLM spend: ${res.status}`);
        return res.json();
      })
      .then(data => setLlmSpend(data))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setLlmSpend(null);
        setLlmSpendError(err instanceof Error ? err.message : 'Failed to fetch LLM spend data');
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLlmSpendLoading(false);
      });
    return () => controller.abort();
  }, [context?.metadata?.subscriptionId]);

  const updateUrl = useCallback((newAppId?: string, newTab?: TabId, newTimeRange?: string) => {
    const params = new URLSearchParams();
    const effectiveAppId = newAppId ?? submittedAppId;
    const effectiveTab = newTab ?? activeTab;
    const effectiveTimeRange = newTimeRange ?? timeRange;

    if (effectiveAppId) {
      params.set('appId', effectiveAppId);
    }
    if (effectiveTab && effectiveTab !== 'details') {
      params.set('tab', effectiveTab);
    }
    if (effectiveTimeRange && effectiveTimeRange !== '24h') {
      params.set('timeRange', effectiveTimeRange);
    }

    const query = params.toString();
    router.push(query ? `/?${query}` : '/', { scroll: false });
  }, [router, submittedAppId, activeTab, timeRange]);

  const handleSearch = () => {
    const trimmed = appId.trim();
    if (trimmed) {
      setSubmittedAppId(trimmed);
      setActiveTab('details');
      updateUrl(trimmed, 'details');
    }
  };

  const handleClear = () => {
    setAppId('');
    setSubmittedAppId('');
    setContext(null);
    setActiveTab('summary');
    router.push('/', { scroll: false });
  };

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    if (submittedAppId) {
      updateUrl(submittedAppId, tabId);
    }
  };

  const handleExpandError = async (errorMessage: string) => {
    if (expandedError === errorMessage) {
      setExpandedError(null);
      return;
    }

    setExpandedError(errorMessage);

    if (!errorDetails[errorMessage] && submittedAppId) {
      try {
        const response = await fetch(
          `/api/error-details?appId=${encodeURIComponent(submittedAppId)}&message=${encodeURIComponent(errorMessage)}&timeRange=${timeRange}`
        );
        if (response.ok) {
          const data = await response.json();
          setErrorDetails(prev => ({ ...prev, [errorMessage]: data.errors || [] }));
        }
      } catch (err) {
        console.error('Failed to fetch error details:', err);
      }
    }
  };

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'details', label: 'Details', icon: '🗂️' },
    { id: 'summary', label: 'Summary', icon: '📊' },
    { id: 'conversation', label: 'Conversation', icon: '💬' },
    { id: 'agent-logs', label: 'Agent Logs', icon: '🤖' },
    { id: 'ui-logs', label: 'UI Logs', icon: '🖥️' },
    { id: 'hosting-logs', label: 'Hosting Logs', icon: '☁️' },
    { id: 'publish', label: 'Publish Events', icon: '🚀' },
    { id: 'llm-spend', label: 'Actual LLM Spend', icon: '💰' },
  ];

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      padding: '2rem'
    }}>
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto'
      }}>
        {/* Header */}
        <header style={{
          backgroundColor: 'white',
          padding: '1.5rem 2rem',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem'
          }}>
            <div>
              <h1 style={{
                margin: 0,
                fontSize: '1.75rem',
                fontWeight: 600,
                color: '#1a1a1a'
              }}>
                Debug Console : Airo AI Builder
              </h1>
              <p style={{
                margin: '0.5rem 0 0 0',
                fontSize: '0.875rem',
                color: '#666'
              }}>
                Enter an App ID to view logs and conversation history
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <a
                href="/analytics"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#3b82f6',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}
              >
                📊 Analytics
              </a>
              <a
                href="/image-search"
                style={{
                  color: '#3b82f6',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  marginLeft: '1rem',
                }}
              >
                Image Search
              </a>
            </div>
          </div>

          {/* App ID and Time Range inputs */}
          <div style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'flex-end',
            flexWrap: 'wrap'
          }}>
            <div style={{ flex: 1, minWidth: '250px', maxWidth: '400px' }}>
              <label style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#374151',
                display: 'block',
                marginBottom: '0.5rem'
              }}>
                App ID
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    type="text"
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearch();
                    }}
                    placeholder="Enter app ID..."
                    style={{
                      width: '100%',
                      padding: '0.625rem 2rem 0.625rem 1rem',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem'
                    }}
                  />
                  {appId && (
                    <button
                      onClick={handleClear}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: '#e5e7eb',
                        border: 'none',
                        borderRadius: '50%',
                        width: '18px',
                        height: '18px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        color: '#6b7280',
                        fontWeight: 'bold'
                      }}
                      title="Clear"
                    >
                      ×
                    </button>
                  )}
                </div>
                <button
                  onClick={handleSearch}
                  disabled={!appId.trim()}
                  style={{
                    padding: '0.625rem 1.25rem',
                    backgroundColor: appId.trim() ? '#3b82f6' : '#9ca3af',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: appId.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    opacity: appId.trim() ? 1 : 0.6
                  }}
                >
                  Search
                </button>
              </div>
            </div>

            <div style={{ minWidth: '180px' }}>
              <label style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#374151',
                display: 'block',
                marginBottom: '0.5rem'
              }}>
                Time Range
              </label>
              <select
                value={timeRange}
                onChange={(e) => { setTimeRange(e.target.value); updateUrl(undefined, undefined, e.target.value); }}
                style={{
                  width: '100%',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  fontSize: '0.875rem',
                  backgroundColor: 'white',
                  cursor: 'pointer'
                }}
              >
                {TIME_RANGES.map((range) => (
                  <option key={range.value} value={range.value}>
                    {range.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        {/* Main Content */}
        {!submittedAppId ? (
          <div style={{
            backgroundColor: 'white',
            padding: '4rem 2rem',
            borderRadius: '8px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
            <h2 style={{
              margin: '0 0 0.5rem 0',
              fontSize: '1.25rem',
              fontWeight: 600,
              color: '#1a1a1a'
            }}>
              Enter an App ID to get started
            </h2>
            <p style={{
              margin: 0,
              fontSize: '0.875rem',
              color: '#6b7280'
            }}>
              View logs, conversation history, and error summaries for your app
            </p>
          </div>
        ) : (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            overflow: 'hidden'
          }}>
            {/* App Info Header */}
            <div style={{
              padding: '1rem 1.5rem',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#f9fafb'
            }}>
              <div>
                <h2 style={{
                  margin: 0,
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  color: '#1a1a1a'
                }}>
                  App: {submittedAppId}
                </h2>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.25rem' }}>
                  {context?.metadata?.lastActivity && (
                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                      Last activity: {formatTimestamp(context.metadata.lastActivity)}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {loading && (
                  <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Loading...
                  </span>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div style={{
              display: 'flex',
              borderBottom: '1px solid #e5e7eb',
              backgroundColor: '#fafafa',
              overflowX: 'auto'
            }}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  style={{
                    padding: '0.875rem 1.5rem',
                    backgroundColor: activeTab === tab.id ? 'white' : 'transparent',
                    border: 'none',
                    borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: activeTab === tab.id ? 600 : 500,
                    color: activeTab === tab.id ? '#3b82f6' : '#6b7280',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div style={{ padding: '1.5rem' }}>
              {error && (
                <div style={{
                  backgroundColor: '#fef2f2',
                  color: '#991b1b',
                  padding: '1rem',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  fontSize: '0.875rem'
                }}>
                  {error}
                </div>
              )}

              {/* Details Tab */}
              <div style={{ display: activeTab === 'details' ? 'flex' : 'none', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => handleRefreshTab('details')}
                    style={{
                      padding: '0.625rem 1.25rem',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: 500
                    }}
                  >
                    Refresh
                  </button>
                </div>
                <AppDetailsPanel appId={submittedAppId} refreshKey={refreshKeys.details} onRefresh={() => handleRefreshTab('details')} />
              </div>

              {/* Summary Tab */}
              <div style={{ display: activeTab === 'summary' ? 'flex' : 'none', flexDirection: 'column', gap: '1rem' }}>
                {/* Refresh Button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => handleRefreshTab('summary')}
                    disabled={loading}
                    style={{
                      padding: '0.625rem 1.25rem',
                      backgroundColor: loading ? '#9ca3af' : '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      opacity: loading ? 0.6 : 1
                    }}
                  >
                    Refresh
                  </button>
                </div>

                {/* Loading State */}
                {(loading || !context) ? (
                  <div style={{
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    backgroundColor: '#f9fafb',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb'
                  }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>⏳</div>
                    <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
                      Loading error summary...
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Error Summary Header */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem',
                      backgroundColor: context.errorSummary?.total ? '#fef2f2' : '#f0fdf4',
                      borderRadius: '6px',
                      border: context.errorSummary?.total ? '1px solid #fecaca' : '1px solid #bbf7d0'
                    }}>
                      <h3 style={{
                        margin: 0,
                        fontSize: '1rem',
                        fontWeight: 600,
                        color: context.errorSummary?.total ? '#991b1b' : '#166534'
                      }}>
                        Error Summary
                      </h3>
                      <div style={{
                        display: 'flex',
                        gap: '1.5rem',
                        fontSize: '0.875rem',
                        fontWeight: 500
                      }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{
                            fontSize: '1.5rem',
                            fontWeight: 700,
                            color: context.errorSummary?.total ? '#dc2626' : '#16a34a'
                          }}>
                            {context.errorSummary?.total ?? 0}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total Errors</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{
                            fontSize: '1.5rem',
                            fontWeight: 700,
                            color: context.errorSummary?.last24Hours ? '#dc2626' : '#16a34a'
                          }}>
                            {context.errorSummary?.last24Hours ?? 0}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Last 24h</div>
                        </div>
                      </div>
                    </div>

                    {/* Error Groups */}
                    {context.errorSummary?.errorGroups && context.errorSummary.errorGroups.length > 0 ? (
                      <div style={{
                        padding: '1rem',
                        backgroundColor: '#f9fafb',
                        borderRadius: '6px',
                        border: '1px solid #e5e7eb'
                      }}>
                        <h4 style={{
                          margin: '0 0 0.75rem 0',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: '#374151'
                        }}>
                          Errors by Message
                        </h4>
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                          maxHeight: '500px',
                          overflowY: 'auto'
                        }}>
                          {context.errorSummary.errorGroups.map((group, index) => (
                            <div key={index}>
                              <div
                                onClick={() => handleExpandError(group.message)}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '0.75rem 1rem',
                                  backgroundColor: expandedError === group.message ? '#fef2f2' : 'white',
                                  borderRadius: expandedError === group.message ? '4px 4px 0 0' : '4px',
                                  border: '1px solid #e5e7eb',
                                  cursor: 'pointer'
                                }}
                              >
                                <div style={{
                                  flex: 1,
                                  fontSize: '0.875rem',
                                  color: '#374151',
                                  wordBreak: 'break-word',
                                  marginRight: '1rem'
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                      {expandedError === group.message ? '▼' : '▶'}
                                    </span>
                                    <div>
                                      {group.event && (
                                        <span style={{
                                          fontSize: '0.7rem',
                                          fontFamily: 'monospace',
                                          color: '#6366f1',
                                          backgroundColor: '#eef2ff',
                                          padding: '0.125rem 0.375rem',
                                          borderRadius: '3px',
                                          marginRight: '0.5rem'
                                        }}>
                                          {group.event}
                                        </span>
                                      )}
                                      {group.message}
                                    </div>
                                  </div>
                                  {group.lastSeen && (
                                    <div style={{
                                      fontSize: '0.7rem',
                                      color: '#6b7280',
                                      marginTop: '0.25rem',
                                      fontFamily: 'monospace',
                                      marginLeft: '1.25rem'
                                    }}>
                                      Last seen: {formatTimestamp(group.lastSeen)}
                                    </div>
                                  )}
                                </div>
                                <div style={{
                                  fontSize: '0.875rem',
                                  fontWeight: 600,
                                  color: '#dc2626',
                                  backgroundColor: '#fef2f2',
                                  padding: '0.25rem 0.75rem',
                                  borderRadius: '9999px',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {group.count}×
                                </div>
                              </div>
                              {expandedError === group.message && (
                                <div style={{
                                  padding: '0.75rem 1rem',
                                  backgroundColor: '#f9fafb',
                                  borderRadius: '0 0 4px 4px',
                                  border: '1px solid #e5e7eb',
                                  borderTop: 'none'
                                }}>
                                  {!errorDetails[group.message] ? (
                                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Loading details...</div>
                                  ) : errorDetails[group.message].length === 0 ? (
                                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>No detailed instances found</div>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                      {errorDetails[group.message].slice(0, 5).map((detail, idx) => (
                                        <div key={idx} style={{
                                          padding: '0.5rem',
                                          backgroundColor: 'white',
                                          borderRadius: '4px',
                                          border: '1px solid #e5e7eb',
                                          fontSize: '0.75rem'
                                        }}>
                                          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.25rem' }}>
                                            <span style={{ color: '#6b7280', fontFamily: 'monospace' }}>
                                              {formatTimestamp(detail.timestamp)}
                                            </span>
                                            {detail.event && (
                                              <span style={{ color: '#3b82f6' }}>{detail.event}</span>
                                            )}
                                            {detail.service && (
                                              <span style={{ color: '#059669' }}>{detail.service}</span>
                                            )}
                                          </div>
                                          <div style={{ color: '#374151', wordBreak: 'break-word' }}>
                                            {detail.message}
                                          </div>
                                          {!!detail.raw?.data && (
                                            <details style={{ marginTop: '0.25rem' }}>
                                              <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: '0.7rem' }}>
                                                View raw data
                                              </summary>
                                              <pre style={{
                                                marginTop: '0.25rem',
                                                padding: '0.5rem',
                                                backgroundColor: '#1f2937',
                                                color: '#f3f4f6',
                                                borderRadius: '4px',
                                                fontSize: '0.65rem',
                                                overflow: 'auto',
                                                maxHeight: '200px'
                                              }}>
                                                {JSON.stringify(detail.raw.data, null, 2)}
                                              </pre>
                                            </details>
                                          )}
                                        </div>
                                      ))}
                                      {errorDetails[group.message].length > 5 && (
                                        <div style={{ fontSize: '0.7rem', color: '#6b7280', textAlign: 'center' }}>
                                          Showing 5 of {errorDetails[group.message].length} instances
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : context.errorSummary?.total === 0 ? (
                      <div style={{
                        padding: '2rem',
                        textAlign: 'center',
                        color: '#166534',
                        backgroundColor: '#f0fdf4',
                        borderRadius: '6px',
                        border: '1px solid #bbf7d0'
                      }}>
                        ✓ No errors found in the selected time range
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {/* Conversation Tab - always rendered for eager loading */}
              <div style={{ display: activeTab === 'conversation' ? 'block' : 'none' }}>
                <LangfusePanel
                  globalAppId={submittedAppId}
                  refreshKey={refreshKeys.conversation}
                  onRefresh={() => handleRefreshTab('conversation')}
                />
              </div>

              {/* Agent Logs Tab - always rendered for eager loading */}
              <div style={{ display: activeTab === 'agent-logs' ? 'block' : 'none' }}>
                <LogsPanel
                  sources={sources}
                  defaultSource="airo-agents"
                  globalAppId={submittedAppId}
                  timeRange={timeRange}
                  refreshKey={refreshKeys['agent-logs']}
                  onRefresh={() => handleRefreshTab('agent-logs')}
                />
              </div>

              {/* UI Logs Tab - always rendered for eager loading */}
              <div style={{ display: activeTab === 'ui-logs' ? 'block' : 'none' }}>
                <LogsPanel
                  sources={sources}
                  defaultSource="airo-app"
                  globalAppId={submittedAppId}
                  timeRange={timeRange}
                  refreshKey={refreshKeys['ui-logs']}
                  onRefresh={() => handleRefreshTab('ui-logs')}
                />
              </div>

              {/* Hosting Logs Tab - always rendered for eager loading */}
              <div style={{ display: activeTab === 'hosting-logs' ? 'block' : 'none' }}>
                <LogsPanel
                  sources={sources}
                  defaultSource="control_plane"
                  globalAppId={submittedAppId}
                  timeRange={timeRange}
                  refreshKey={refreshKeys['hosting-logs']}
                  onRefresh={() => handleRefreshTab('hosting-logs')}
                />
              </div>

              {/* Publish Events Tab */}
              <div style={{ display: activeTab === 'publish' ? 'block' : 'none' }}>
                <PublishEventsPanel
                  appId={submittedAppId}
                  timeRange={timeRange}
                  refreshKey={refreshKeys['publish']}
                  onRefresh={() => handleRefreshTab('publish')}
                />
              </div>

              {/* Actual LLM Spend Tab */}
              <div style={{ display: activeTab === 'llm-spend' ? 'flex' : 'none', flexDirection: 'column', gap: '1rem' }}>
                {!context?.metadata?.subscriptionId ? (
                  <div style={{
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    backgroundColor: '#f9fafb',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb'
                  }}>
                    <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
                      No billing subscription ID found for this app
                    </p>
                  </div>
                ) : llmSpendLoading ? (
                  <div style={{
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    backgroundColor: '#f9fafb',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb'
                  }}>
                    <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
                      Loading spend data...
                    </p>
                  </div>
                ) : llmSpendError ? (
                  <div style={{
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    backgroundColor: '#fef2f2',
                    borderRadius: '6px',
                    border: '1px solid #fecaca'
                  }}>
                    <p style={{ margin: 0, color: '#dc2626', fontSize: '0.875rem' }}>
                      {llmSpendError}
                    </p>
                  </div>
                ) : !llmSpend ? (
                  <div style={{
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    backgroundColor: '#f9fafb',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb'
                  }}>
                    <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
                      No spend data available
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Subscription Header */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.375rem',
                      padding: '0.75rem 1rem',
                      backgroundColor: '#f9fafb',
                      borderRadius: '6px',
                      border: '1px solid #e5e7eb'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                          Billing SID: <span style={{ fontFamily: 'monospace', color: '#374151' }}>{context.metadata.subscriptionId}</span>
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                          {llmSpend.docCount} records
                        </span>
                      </div>
                      {llmSpend.grantUserIds?.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          {llmSpend.grantUserIds.map(uid => (
                            <span key={uid} style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                              Grant user: <span style={{ fontFamily: 'monospace', color: '#374151' }}>{uid}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Spend Summary Cards */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                      gap: '0.75rem'
                    }}>
                      <div style={{
                        padding: '1rem',
                        backgroundColor: '#f0fdf4',
                        borderRadius: '6px',
                        border: '1px solid #bbf7d0',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#059669' }}>
                          ${llmSpend.totalSpend.toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total Spend</div>
                      </div>
                      <div style={{
                        padding: '1rem',
                        backgroundColor: '#eff6ff',
                        borderRadius: '6px',
                        border: '1px solid #bfdbfe',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3b82f6' }}>
                          {(llmSpend.totalTokens / 1_000_000).toFixed(1)}M
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total Tokens</div>
                      </div>
                      <div style={{
                        padding: '1rem',
                        backgroundColor: '#f5f3ff',
                        borderRadius: '6px',
                        border: '1px solid #ddd6fe',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#8b5cf6' }}>
                          {llmSpend.totalRequests.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>API Requests</div>
                      </div>
                      <div style={{
                        padding: '1rem',
                        backgroundColor: '#f9fafb',
                        borderRadius: '6px',
                        border: '1px solid #e5e7eb',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#6b7280' }}>
                          {llmSpend.dailySpend.length}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Active Days</div>
                      </div>
                    </div>

                    {/* Daily Spend Table */}
                    {llmSpend.dailySpend.length > 0 && (
                      <div style={{
                        backgroundColor: 'white',
                        borderRadius: '6px',
                        border: '1px solid #e5e7eb',
                        overflow: 'hidden'
                      }}>
                        <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                          <table style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '0.8rem'
                          }}>
                            <thead>
                              <tr style={{ backgroundColor: '#f3f4f6', position: 'sticky', top: 0 }}>
                                <th style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Date</th>
                                <th style={{ padding: '0.625rem 1rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Spend</th>
                                <th style={{ padding: '0.625rem 1rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Prompt</th>
                                <th style={{ padding: '0.625rem 1rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Completion</th>
                                <th style={{ padding: '0.625rem 1rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Total Tokens</th>
                                <th style={{ padding: '0.625rem 1rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Cache Read</th>
                                <th style={{ padding: '0.625rem 1rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Requests</th>
                              </tr>
                            </thead>
                            <tbody>
                              {llmSpend.dailySpend.map((day) => (
                                <tr key={day.date} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                  <td style={{ padding: '0.625rem 1rem', fontFamily: 'monospace', color: '#374151' }}>{day.date}</td>
                                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'monospace', color: '#059669', fontWeight: 600 }}>
                                    ${day.spend.toFixed(4)}
                                  </td>
                                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'monospace', color: '#3b82f6' }}>
                                    {(day.promptTokens / 1000).toFixed(0)}k
                                  </td>
                                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'monospace', color: '#3b82f6' }}>
                                    {(day.completionTokens / 1000).toFixed(0)}k
                                  </td>
                                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'monospace', color: '#374151', fontWeight: 500 }}>
                                    {(day.totalTokens / 1000).toFixed(0)}k
                                  </td>
                                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'monospace', color: '#8b5cf6' }}>
                                    {(day.cacheReadTokens / 1000).toFixed(0)}k
                                  </td>
                                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'monospace', color: '#6b7280' }}>
                                    {day.requests.toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
