'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { formatTimestamp } from '@/lib/date-utils';

interface CommerceBinding {
  appId: string;
  businessId: string | null;
  businessName: string | null;
  storeId: string | null;
  storeName: string | null;
  storeUrl: string | null;
  channelId: string | null;
  channelName: string | null;
  defaultLocationId: string | null;
  status: string;
  source: string;
  lastVerifiedAt: string | null;
  verificationError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CommerceBindingResponse {
  configured: boolean;
  binding: CommerceBinding | null;
}

interface Props {
  appId: string;
  refreshKey: number;
  onRefresh?: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  godaddy_payments: 'GoDaddy Payments',
  stripe: 'Stripe',
  unknown: 'Unknown',
};

export default function CommercePanel({ appId, refreshKey, onRefresh }: Props) {
  const [status, setStatus] = useState<CommerceBindingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!appId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/agent/commerce/${encodeURIComponent(appId)}`, { signal });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        setStatus(json as CommerceBindingResponse);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load commerce binding');
        setStatus(null);
      } finally {
        setLoading(false);
      }
    },
    [appId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  if (!appId) {
    return <div style={emptyStyle}>Enter an App ID above to view commerce details.</div>;
  }

  if (loading && !status) {
    return <div style={emptyStyle}>Loading commerce details…</div>;
  }

  if (error) {
    return (
      <div style={errorStyle}>
        <span>Failed to load commerce details: {error}</span>
        {onRefresh && (
          <button type="button" style={retryButtonStyle} onClick={onRefresh}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!status || !status.configured || !status.binding) {
    return (
      <div>
        <PanelHeader onRefresh={onRefresh} loading={loading} />
        <div style={emptyStyle}>No commerce configuration found for this app.</div>
      </div>
    );
  }

  const binding = status.binding;
  const paymentProvider = binding ? 'godaddy_payments' : 'unknown';

  return (
    <div>
      <PanelHeader onRefresh={onRefresh} loading={loading} />

      <section style={cardStyle}>
        <h3 style={cardTitleStyle}>Commerce Overview</h3>
        <div style={gridStyle}>
          <Field label="Commerce Intent">
            <Badge color="#1d4ed8" bg="#dbeafe">
              {status.configured ? 'Detected' : 'None'}
            </Badge>
          </Field>
          <Field label="Payment Provider">
            <Badge color="#6b21a8" bg="#f3e8ff">
              {PROVIDER_LABELS[paymentProvider] ?? paymentProvider}
            </Badge>
          </Field>
          <Field label="Status">
            <StatusBadge value={binding.status} />
          </Field>
          <Field label="Connected Store ID">
            <Mono>{binding.storeId ?? '—'}</Mono>
          </Field>
          <Field label="Connected Store Name">{binding.storeName ?? '—'}</Field>
          <Field label="Connected Channel ID">
            <Mono>{binding.channelId ?? '—'}</Mono>
          </Field>
          <Field label="Connected Business ID">
            <Mono>{binding.businessId ?? '—'}</Mono>
          </Field>
          <Field label="Connected Business Name">{binding.businessName ?? '—'}</Field>
          <Field label="Source">
            <Mono>{binding.source}</Mono>
          </Field>
          <Field label="Last Verified">
            {binding.lastVerifiedAt ? formatTimestamp(binding.lastVerifiedAt) : '—'}
          </Field>
        </div>
        {binding.verificationError && (
          <div style={verificationErrorStyle}>Verification error: {binding.verificationError}</div>
        )}
      </section>
    </div>
  );
}

function PanelHeader({ onRefresh, loading }: { onRefresh?: () => void; loading: boolean }) {
  return (
    <div style={headerRowStyle}>
      <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
        Commerce binding &amp; payment activity for this app
      </span>
      {onRefresh && (
        <button type="button" style={refreshButtonStyle} onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
      <div style={fieldLabelStyle}>{label}:</div>
      <div style={{ fontSize: '0.875rem', color: '#111827' }}>{children}</div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
      {children}
    </span>
  );
}

function Badge({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.125rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.7rem',
        fontWeight: 600,
        color,
        backgroundColor: bg,
      }}
    >
      {children}
    </span>
  );
}

function StatusBadge({ value }: { value: string }) {
  const green = ['channel_ready'];
  const red = ['invalid'];
  const isGreen = green.includes(value);
  const isRed = red.includes(value);
  const color = isGreen ? '#16a34a' : isRed ? '#dc2626' : '#d97706';
  const bg = isGreen ? '#f0fdf4' : isRed ? '#fef2f2' : '#fffbeb';
  return (
    <Badge color={color} bg={bg}>
      {value}
    </Badge>
  );
}

const emptyStyle: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '0.875rem',
  padding: '1rem',
};

const errorStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  padding: '0.5rem 0.75rem',
  backgroundColor: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: '6px',
  fontSize: '0.813rem',
  color: '#dc2626',
};

const retryButtonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #fecaca',
  borderRadius: '4px',
  color: '#dc2626',
  cursor: 'pointer',
  fontSize: '0.75rem',
  padding: '0.25rem 0.5rem',
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 0.25rem 0.75rem',
};

const refreshButtonStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '6px',
  color: '#3b82f6',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: 600,
  padding: '0.375rem 0.75rem',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  padding: '1rem',
  marginBottom: '0.75rem',
};

const cardTitleStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '0.95rem',
  fontWeight: 700,
  color: '#1a1a1a',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: '0.625rem 1.5rem',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#6b7280',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const verificationErrorStyle: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.5rem 0.75rem',
  backgroundColor: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: '6px',
  fontSize: '0.8rem',
  color: '#dc2626',
};
