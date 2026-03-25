'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useState } from 'react';

import AppDetailsPanel from '@/components/AppDetailsPanel';
import type { MgmtCustomerApp, MgmtSubscription, MgmtSubscriptionGrants } from '@/lib/mgmt-types';
import { formatTimestamp } from '@/lib/date-utils';
import { CUSTOMER_ID_RE } from '@/lib/mgmt-helpers';
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
  cacheWriteTokens: number;
  requests: number;
}

interface GrantBreakdown {
  grantUserId: string;
  totalSpend: number;
  totalTokens: number;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  dailySpend: SpendDay[];
}

interface LlmSpendData {
  subscriptionId?: string;
  grantUserIds: string[];
  totalSpend: number;
  totalTokens: number;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  grantBreakdowns: GrantBreakdown[];
  docCount: number;
  truncated?: boolean;
}

type TabId = 'details' | 'summary' | 'conversation' | 'logs' | 'publish' | 'llm-spend';


function GrantSpendSection({ grant, mgmtGrant, isActive }: { grant: GrantBreakdown; mgmtGrant?: import('@/lib/mgmt-types').MgmtGrant; isActive?: boolean }) {
  const [expanded, setExpanded] = React.useState(true);
  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
  const pct = mgmtGrant && mgmtGrant.creditsMax > 0 ? Math.min(100, Math.round(mgmtGrant.creditsSpent / mgmtGrant.creditsMax * 100)) : null;
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
      {/* Grant header */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 1rem', backgroundColor: '#f9fafb', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: '0.65rem', color: '#6b7280' }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#1f2937', fontWeight: 600, flexShrink: 0 }}>{grant.grantUserId}</span>
        {isActive && <span style={{ fontSize: '0.6rem', color: '#2563eb', backgroundColor: '#dbeafe', padding: '0.1rem 0.35rem', borderRadius: '9999px', fontWeight: 600, flexShrink: 0 }}>active</span>}
        {mgmtGrant && <span style={{ fontSize: '0.7rem', color: mgmtGrant.isAvailable ? '#16a34a' : '#6b7280', flexShrink: 0 }}>{mgmtGrant.isAvailable ? 'available' : (mgmtGrant.finalState ?? 'unavailable')}</span>}
        {/* Credit gauge */}
        {pct !== null && mgmtGrant && (
          <>
            <div style={{ width: '80px', height: '4px', backgroundColor: '#e5e7eb', borderRadius: '2px', overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ width: `${pct}%`, height: '100%', backgroundColor: pct > 90 ? '#ef4444' : '#3b82f6', borderRadius: '2px' }} />
            </div>
            <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#374151', flexShrink: 0 }}>{mgmtGrant.creditsSpent}/{mgmtGrant.creditsMax} ({pct}%)</span>
            {mgmtGrant.useBefore && <span style={{ fontSize: '0.7rem', color: '#6b7280', flexShrink: 0 }}>until {mgmtGrant.useBefore.split('T')[0]}</span>}
          </>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#059669', fontWeight: 700, flexShrink: 0 }}>${grant.totalSpend.toFixed(4)}</span>
        <span style={{ fontSize: '0.72rem', color: '#6b7280', flexShrink: 0 }}>{fmt(grant.totalTokens)} tokens</span>
        <span style={{ fontSize: '0.72rem', color: '#8b5cf6', flexShrink: 0 }}>{grant.totalRequests.toLocaleString()} reqs</span>
        <span style={{ fontSize: '0.72rem', color: '#6b7280', flexShrink: 0 }}>{grant.dailySpend.length} days</span>
      </button>
      {expanded && (
        <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Daily table */}
          {grant.dailySpend.length > 0 && (
            <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid #f3f4f6', borderRadius: '4px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Date</th>
                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#059669' }}>Spend</th>
                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#3b82f6' }}>Input</th>
                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#8b5cf6' }}>Cache Read</th>
                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#d97706' }}>Cache Write</th>
                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>Output</th>
                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Total</th>
                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#6b7280' }}>Reqs</th>
                  </tr>
                </thead>
                <tbody>
                  {grant.dailySpend.map(day => (
                    <tr key={day.date} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.35rem 0.75rem', fontFamily: 'monospace', color: '#374151' }}>{day.date}</td>
                      <td style={{ padding: '0.35rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#059669', fontWeight: 600 }}>${day.spend.toFixed(4)}</td>
                      <td style={{ padding: '0.35rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#3b82f6' }}>{(day.promptTokens / 1000).toFixed(1)}k</td>
                      <td style={{ padding: '0.35rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#8b5cf6' }}>{day.cacheReadTokens > 0 ? `${(day.cacheReadTokens / 1000).toFixed(1)}k` : '—'}</td>
                      <td style={{ padding: '0.35rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#d97706' }}>{day.cacheWriteTokens > 0 ? `${(day.cacheWriteTokens / 1000).toFixed(1)}k` : '—'}</td>
                      <td style={{ padding: '0.35rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#10b981' }}>{(day.completionTokens / 1000).toFixed(1)}k</td>
                      <td style={{ padding: '0.35rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#374151', fontWeight: 500 }}>{(day.totalTokens / 1000).toFixed(1)}k</td>
                      <td style={{ padding: '0.35rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#6b7280' }}>{day.requests.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [appId, setAppId] = useState('');
  const [submittedAppId, setSubmittedAppId] = useState('');
  const [submittedCustomerId, setSubmittedCustomerId] = useState('');
  const [customerApps, setCustomerApps] = useState<MgmtCustomerApp[]>([]);
  const [customerAppsLoading, setCustomerAppsLoading] = useState(false);
  const [customerAppsError, setCustomerAppsError] = useState<string | null>(null);
  const [customerAppsRefresh, setCustomerAppsRefresh] = useState(0);
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
  // Subscription + grant data lifted from AppDetailsPanel
  const [mgmtRawSubId, setMgmtRawSubId] = useState<string | null>(null);
  const [mgmtGrantUserIds, setMgmtGrantUserIds] = useState<string[]>([]);
  const [mgmtSubscription, setMgmtSubscription] = useState<MgmtSubscription | null>(null);
  const [mgmtGrants, setMgmtGrants] = useState<MgmtSubscriptionGrants | null>(null);
  // true once AppDetailsPanel confirms whether a subscription exists or not
  const [mgmtSubscriptionResolved, setMgmtSubscriptionResolved] = useState(false);

  const [refreshKeys, setRefreshKeys] = useState({
    details: 0,
    summary: 0,
    conversation: 0,
    logs: 0,
    publish: 0,
    'llm-spend': 0,
  });

  const handleRefreshTab = useCallback((tabId: TabId) => {
    setRefreshKeys(prev => ({ ...prev, [tabId]: prev[tabId] + 1 }));
  }, []);

  // Initialize from URL params on mount only
  useEffect(() => {
    const urlAppId = searchParams?.get('appId');
    const urlCustomerId = searchParams?.get('customerId');
    const urlTab = searchParams?.get('tab') as TabId | null;
    const urlTimeRange = searchParams?.get('timeRange');
    if (urlCustomerId) {
      setAppId(urlCustomerId);
      setSubmittedCustomerId(urlCustomerId);
      if (urlAppId) {
        setSubmittedAppId(urlAppId);
      }
    } else if (urlAppId) {
      setAppId(urlAppId);
      setSubmittedAppId(urlAppId);
    }
    if (urlTab && ['details', 'summary', 'conversation', 'logs', 'publish', 'llm-spend'].includes(urlTab)) {
      setActiveTab(urlTab);
    }
    if (urlTimeRange && VALID_TIME_RANGE_VALUES.includes(urlTimeRange)) {
      setTimeRange(urlTimeRange);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch log sources on mount
  useEffect(() => {
    fetch('/api/log-sources')
      .then(res => res.ok ? res.json() : { sources: [] })
      .then(data => setSources(data.sources || []))
      .catch(() => setSources([]));
  }, []);

  // Fetch customer apps when customerId is submitted
  useEffect(() => {
    if (!submittedCustomerId) {
      setCustomerApps([]);
      return;
    }

    const controller = new AbortController();
    setCustomerAppsLoading(true);
    setCustomerAppsError(null);

    fetch(`/api/mgmt/customers/${encodeURIComponent(submittedCustomerId)}/apps`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) {
          if (res.status >= 500) throw new Error(`Internal error (${res.status}) — the management service may be temporarily unavailable`);
          return res.json().then(d => { throw new Error(d.error || `HTTP ${res.status}`); });
        }
        return res.json();
      })
      .then(data => setCustomerApps(data))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setCustomerAppsError(err instanceof Error ? err.message : 'Failed to fetch customer apps');
      })
      .finally(() => {
        if (!controller.signal.aborted) setCustomerAppsLoading(false);
      });

    return () => controller.abort();
  }, [submittedCustomerId, customerAppsRefresh]);

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

  // Reset mgmt data when the app changes
  useEffect(() => {
    setMgmtRawSubId(null);
    setMgmtGrantUserIds([]);
    setMgmtSubscription(null);
    setMgmtGrants(null);
    setMgmtSubscriptionResolved(false);
    setLlmSpend(null);
  }, [submittedAppId]);

  // Fetch LLM spend once grants are available from AppDetailsPanel (via onGrantsLoaded callback).
  // Uses llmBudgetUserId from ALL grants (active + historical) sourced from the mgmt API —
  // no dependency on the log-derived billing SID from app-context.
  useEffect(() => {
    if (mgmtGrantUserIds.length === 0) {
      setLlmSpend(null);
      return;
    }

    const controller = new AbortController();
    setLlmSpendLoading(true);
    setLlmSpendError(null);

    const params = new URLSearchParams();
    if (mgmtRawSubId) params.set('subscriptionId', mgmtRawSubId);
    for (const uid of mgmtGrantUserIds) {
      params.append('grantUserId', uid);
    }
    // Also include the subscription-level end_user (airo-builder:sid:<subId>) which
    // may carry spend from calls that use the subscription ID directly (e.g. older billing).
    if (mgmtRawSubId) params.append('grantUserId', `airo-builder:sid:${mgmtRawSubId}`);

    fetch(`/api/llm-spend?${params}`, { signal: controller.signal })
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
  }, [mgmtGrantUserIds, mgmtRawSubId]);

  const updateUrl = useCallback((opts?: { appId?: string | null; customerId?: string | null; tab?: TabId; timeRange?: string }) => {
    const params = new URLSearchParams();
    const effectiveCustomerId = opts?.customerId !== undefined ? opts.customerId : submittedCustomerId;
    const effectiveAppId = opts?.appId !== undefined ? opts.appId : submittedAppId;
    const effectiveTab = opts?.tab ?? activeTab;
    const effectiveTimeRange = opts?.timeRange ?? timeRange;

    if (effectiveCustomerId) {
      params.set('customerId', effectiveCustomerId);
    }
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
  }, [router, submittedAppId, submittedCustomerId, activeTab, timeRange]);

  const isUUID = (value: string) => CUSTOMER_ID_RE.test(value);

  const handleSearch = () => {
    const trimmed = appId.trim();
    if (!trimmed) return;

    if (isUUID(trimmed)) {
      setSubmittedAppId('');
      if (submittedCustomerId === trimmed) setCustomerAppsRefresh(k => k + 1);
      setSubmittedCustomerId(trimmed);
      updateUrl({ customerId: trimmed, appId: null, tab: 'details' });
    } else {
      setSubmittedCustomerId('');
      setSubmittedAppId(trimmed);
      setActiveTab('details');
      updateUrl({ appId: trimmed, customerId: null, tab: 'details' });
    }
  };

  // Collect llmBudgetUserId from ALL grants (active + historical) so LLM Spend captures
  // spend across every billing period — deduplicated to avoid duplicate ES query terms.
  // Raw subscriptionId from mgmt is stored for display purposes only.
  const handleGrantsLoaded = useCallback((subscriptionId: string, grants: MgmtSubscriptionGrants) => {
    setMgmtRawSubId(subscriptionId);
    const ids = [...new Set(
      grants.grants
        .map(g => g.llmBudgetUserId)
        .filter((id): id is string => Boolean(id))
    )];
    setMgmtGrantUserIds(ids);
  }, []);

  const handleSubscriptionLoaded = useCallback((subscription: MgmtSubscription, grants: MgmtSubscriptionGrants) => {
    setMgmtSubscription(subscription);
    setMgmtGrants(grants);
    setMgmtSubscriptionResolved(true);
  }, []);

  // Called by AppDetailsPanel when the app has no subscriptionId — marks the tab as resolved
  // so the Subscription tab doesn't show "Loading…" indefinitely.
  const handleNoSubscription = useCallback(() => {
    setMgmtSubscriptionResolved(true);
  }, []);

  const handleClear = () => {
    setAppId('');
    setSubmittedAppId('');
    setSubmittedCustomerId('');
    setCustomerApps([]);
    setCustomerAppsError(null);
    setContext(null);
    setActiveTab('summary');
    router.push('/', { scroll: false });
  };

  const handleSelectCustomerApp = (selectedAppId: string) => {
    setSubmittedAppId(selectedAppId);
    setActiveTab('details');
    updateUrl({ appId: selectedAppId, tab: 'details' });
  };

  const handleBackToCustomerApps = () => {
    setSubmittedAppId('');
    setContext(null);
    setActiveTab('details');
    updateUrl({ appId: null, tab: 'details' });
  };

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    if (submittedAppId) {
      updateUrl({ tab: tabId });
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
    { id: 'logs', label: 'Logs', icon: '📋' },
    { id: 'publish', label: 'Publish Events', icon: '🚀' },
    { id: 'llm-spend', label: 'Subscription', icon: '💳' },
  ];

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      padding: '0.5rem 1.5rem'
    }}>
      <div>
        {/* Compact single-row header */}
        <header style={{
          backgroundColor: 'white',
          padding: '0.75rem 1rem',
          borderRadius: '6px',
          marginBottom: '0.5rem',
          boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          minHeight: '3.25rem'
        }}>
          <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#1a1a1a', whiteSpace: 'nowrap' }}>
            Airo AI Builder Console
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: '500px' }}>
              <input
                type="text"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                placeholder="App ID or Customer ID..."
                style={{
                  width: '100%',
                  padding: appId.trim() ? '0.375rem 4.5rem 0.375rem 0.625rem' : '0.375rem 1.75rem 0.375rem 0.625rem',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  fontSize: '0.875rem'
                }}
              />
              {appId.trim() && (
                <span style={{
                  position: 'absolute', right: '24px', top: '50%', transform: 'translateY(-50%)',
                  fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                  padding: '0.1rem 0.3rem', borderRadius: '3px',
                  backgroundColor: isUUID(appId.trim()) ? '#dbeafe' : '#f0fdf4',
                  color: isUUID(appId.trim()) ? '#1d4ed8' : '#15803d',
                  pointerEvents: 'none',
                }}>
                  {isUUID(appId.trim()) ? 'customerId' : 'appId'}
                </span>
              )}
              {appId && (
                <button
                  onClick={handleClear}
                  style={{
                    position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                    background: '#e5e7eb', border: 'none', borderRadius: '50%',
                    width: '16px', height: '16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', color: '#6b7280', fontWeight: 'bold'
                  }}
                  title="Clear"
                >×</button>
              )}
            </div>
            <button
              onClick={handleSearch}
              disabled={!appId.trim()}
              style={{
                padding: '0.375rem 0.75rem',
                backgroundColor: appId.trim() ? '#3b82f6' : '#9ca3af',
                color: 'white', border: 'none', borderRadius: '4px',
                cursor: appId.trim() ? 'pointer' : 'not-allowed',
                fontSize: '0.875rem', fontWeight: 500,
                opacity: appId.trim() ? 1 : 0.6
              }}
            >Search</button>
            <select
              value={timeRange}
              onChange={(e) => { setTimeRange(e.target.value); updateUrl({ timeRange: e.target.value }); }}
              style={{
                padding: '0.375rem 0.5rem', borderRadius: '4px',
                border: '1px solid #d1d5db', fontSize: '0.875rem',
                backgroundColor: 'white', cursor: 'pointer'
              }}
            >
              {TIME_RANGES.map((range) => (
                <option key={range.value} value={range.value}>{range.label}</option>
              ))}
            </select>
          </div>
          {loading && <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Loading...</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
            <a href="/analytics" target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-block', padding: '0.375rem 0.875rem', backgroundColor: '#3b82f6', color: 'white', borderRadius: '4px', textDecoration: 'none', fontSize: '0.813rem', fontWeight: 600 }}>Analytics</a>
            <a href="/agentic-qa-results"
              style={{ display: 'inline-block', padding: '0.375rem 0.875rem', backgroundColor: '#6366f1', color: 'white', borderRadius: '4px', textDecoration: 'none', fontSize: '0.813rem', fontWeight: 600 }}>QA Results</a>
            <a href="/image-search"
              style={{ display: 'inline-block', padding: '0.375rem 0.875rem', backgroundColor: '#6b7280', color: 'white', borderRadius: '4px', textDecoration: 'none', fontSize: '0.813rem', fontWeight: 600 }}>Images</a>
          </div>
        </header>

        {/* Main Content */}
        {submittedCustomerId && !submittedAppId ? (
          /* Customer apps list view */
          <div style={{
            backgroundColor: 'white',
            borderRadius: '6px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
            overflow: 'hidden',
            maxWidth: '1200px',
            margin: '0 auto',
          }}>
            <div style={{
              padding: '0.75rem 1rem',
              borderBottom: '1px solid #f3f4f6',
              backgroundColor: '#fafafa',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
                Customer: {submittedCustomerId}
              </span>
              {!customerAppsLoading && customerApps.length > 0 && (
                <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                  ({customerApps.length} app{customerApps.length !== 1 ? 's' : ''})
                </span>
              )}
            </div>
            <div style={{ padding: '0.75rem' }}>
              {customerAppsLoading ? (
                <div style={{ padding: '3rem 2rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>
                  Loading customer apps...
                </div>
              ) : customerAppsError ? (
                <div style={{ padding: '1rem', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '4px', fontSize: '0.813rem' }}>
                  {customerAppsError}
                </div>
              ) : customerApps.length === 0 ? (
                <div style={{ padding: '3rem 2rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>
                  No apps found for this customer
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f9fafb' }}>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>App ID</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Published</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerApps.map(app => (
                        <tr
                          key={app.appId}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSelectCustomerApp(app.appId)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectCustomerApp(app.appId); } }}
                          style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f0f7ff')}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
                        >
                          <td style={{ padding: '0.5rem 0.75rem' }}>
                            <div style={{ fontFamily: 'monospace', color: '#2563eb', fontWeight: 600 }}>{app.appId}</div>
                            <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#9ca3af', marginTop: '0.1rem' }}>{app.subscriptionId}</div>
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.4rem',
                              borderRadius: '9999px',
                              fontWeight: 600,
                              backgroundColor: app.status === 'RUNNING' ? '#dcfce7' : app.status === 'STOPPED' ? '#fee2e2' : '#f3f4f6',
                              color: app.status === 'RUNNING' ? '#166534' : app.status === 'STOPPED' ? '#991b1b' : '#374151',
                            }}>{app.status}</span>
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', color: app.published ? '#16a34a' : '#6b7280' }}>
                            {app.published ? 'Yes' : 'No'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : !submittedAppId ? (
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
              Enter an App ID or Customer ID to get started
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
            borderRadius: '6px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 'calc(100vh - 3.5rem)'
          }}>
            {/* App ID label / breadcrumb */}
            <div style={{
              padding: '0.5rem 0.75rem',
              borderBottom: '1px solid #f3f4f6',
              backgroundColor: '#fafafa',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              {submittedCustomerId && (
                <>
                  <button
                    onClick={handleBackToCustomerApps}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: '0.813rem', color: '#2563eb', fontWeight: 600,
                      padding: 0,
                    }}
                  >
                    Customer: {submittedCustomerId}
                  </button>
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>&gt;</span>
                </>
              )}
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
                app id - {submittedAppId}
              </span>
            </div>
            {/* Tabs bar — centered */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: '1px solid #e5e7eb',
              backgroundColor: '#fafafa',
              gap: '0'
            }}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: activeTab === tab.id ? 'white' : 'transparent',
                    border: 'none',
                    borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: '0.84rem',
                    fontWeight: activeTab === tab.id ? 600 : 500,
                    color: activeTab === tab.id ? '#3b82f6' : '#6b7280',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div style={{ padding: '0.75rem', flex: 1 }}>
              {error && (
                <div style={{
                  backgroundColor: '#fef2f2',
                  color: '#991b1b',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '4px',
                  marginBottom: '0.5rem',
                  fontSize: '0.813rem'
                }}>
                  {error}
                </div>
              )}

              {/* Details Tab */}
              <div style={{ display: activeTab === 'details' ? 'flex' : 'none', flexDirection: 'column', gap: '1rem', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
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
                <AppDetailsPanel appId={submittedAppId} refreshKey={refreshKeys.details} onRefresh={() => handleRefreshTab('details')} onGrantsLoaded={handleGrantsLoaded} onSubscriptionLoaded={handleSubscriptionLoaded} onNoSubscription={handleNoSubscription} />
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
                          gap: '0.5rem'
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

              {/* Logs Tab */}
              <div style={{ display: activeTab === 'logs' ? 'block' : 'none' }}>
                <LogsPanel
                  sources={sources}
                  globalAppId={submittedAppId}
                  timeRange={timeRange}
                  refreshKey={refreshKeys.logs}
                  onRefresh={() => handleRefreshTab('logs')}
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

              {/* Subscription Tab */}
              <div style={{ display: activeTab === 'llm-spend' ? 'flex' : 'none', flexDirection: 'column', gap: '1rem', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>

                {/* Subscription details — shown as soon as data is available */}
                {mgmtSubscription && (
                  <div style={{ padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {/* Subscription fields + per-grant gauges in one header block */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                      {[
                        { label: 'Plan', value: mgmtSubscription.plan },
                        { label: 'Status', value: mgmtSubscription.status },
                        { label: 'Trial', value: mgmtSubscription.isTrial ? 'yes' : 'no' },
                        { label: 'Sub ID', value: mgmtSubscription.id },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <div style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>{label}</div>
                          <div style={{ fontFamily: 'monospace', color: '#111827' }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {mgmtGrantUserIds.length === 0 ? (
                  <div style={{
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    backgroundColor: '#f9fafb',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb'
                  }}>
                    <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
                      {!submittedAppId
                        ? 'Enter an app ID to view subscription data'
                        : !mgmtSubscriptionResolved
                          ? 'Loading subscription data...'
                          : 'No grant data available for this app — check the Details tab'}
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
                    {/* Summary row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '0.25rem 0', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                      <span>Total: <strong style={{ color: '#059669' }}>${llmSpend.totalSpend.toFixed(2)}</strong></span>
                      <span style={{ color: '#6b7280' }}>{llmSpend.totalRequests.toLocaleString()} requests</span>
                    </div>

                    {/* Truncation warning */}
                    {llmSpend.truncated && (
                      <div style={{ padding: '0.5rem 0.75rem', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '0.78rem', color: '#92400e' }}>
                        ⚠ Results are truncated — {llmSpend.docCount} total records matched but only the first 500 are shown. Totals may be incomplete.
                      </div>
                    )}

                    {/* Per-grant sections */}
                    {llmSpend.grantBreakdowns.map(grant => {
                      const mg = mgmtGrants?.grants.find(g => g.llmBudgetUserId === grant.grantUserId);
                      return (
                        <GrantSpendSection
                          key={grant.grantUserId}
                          grant={grant}
                          mgmtGrant={mg}
                          isActive={!!mg && mg.id === mgmtGrants?.activeGrant}
                        />
                      );
                    })}
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
