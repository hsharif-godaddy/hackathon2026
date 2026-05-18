'use client';

import React, { useState } from 'react';

import { EbSessionDetailView, EbTraceDetailView, MgmtAppDetailView } from '@/components/LangfuseDeepDiveViews';
import { risqSectionDataPanel } from '@/components/RisqSectionCard';

const DEFAULT_TRACE_ID = 'e483ae44c72e4df689f09232f3fd18ce';
const DEFAULT_SESSION_ID = '9238c039-a5b3-4ad2-8ea2-23fb118b06a8';
const DEFAULT_APP_ID = 'bs3708nql0';

const sectionLabel: React.CSSProperties = {
  margin: '0 0 0.75rem 0',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#334155',
};

const blockTitle: React.CSSProperties = {
  margin: '0 0 0.65rem 0',
  fontSize: '0.82rem',
  fontWeight: 600,
  color: '#0f172a',
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: '0.62rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: '#64748b',
  marginBottom: '0.35rem',
};

const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.5rem 0.65rem',
  fontSize: '0.82rem',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  marginBottom: '0.55rem',
};

const btn: React.CSSProperties = {
  padding: '0.45rem 1rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  borderRadius: 8,
  border: 'none',
  backgroundColor: '#5b21b6',
  color: '#ffffff',
  cursor: 'pointer',
};

const caption: React.CSSProperties = {
  margin: '0.5rem 0 0 0',
  fontSize: '0.72rem',
  color: '#64748b',
  lineHeight: 1.45,
};

const traceSessionStack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.15rem',
  width: '100%',
  boxSizing: 'border-box',
};

const fullWidthFieldCol: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
};

const errText: React.CSSProperties = {
  marginTop: '0.5rem',
  fontSize: '0.75rem',
  color: '#b91c1c',
};

export default function LangfuseDeepDiveSearchPanel() {
  const [traceId, setTraceId] = useState(DEFAULT_TRACE_ID);
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION_ID);
  const [appId, setAppId] = useState(DEFAULT_APP_ID);

  const [traceLoading, setTraceLoading] = useState(false);
  const [traceErr, setTraceErr] = useState<string | null>(null);
  const [traceData, setTraceData] = useState<unknown>(null);

  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionErr, setSessionErr] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<unknown>(null);

  const [appLoading, setAppLoading] = useState(false);
  const [appErr, setAppErr] = useState<string | null>(null);
  const [appData, setAppData] = useState<unknown>(null);

  async function runTraceFetch() {
    const id = traceId.trim();
    if (!id) return;
    setTraceLoading(true);
    setTraceErr(null);
    try {
      const res = await fetch(`/api/eb-langfuse/traces/${encodeURIComponent(id)}`);
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          body &&
          typeof body === 'object' &&
          'error' in body &&
          typeof (body as { error: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `HTTP ${res.status}`;
        setTraceErr(msg);
        setTraceData(null);
        return;
      }
      setTraceData(body);
      setTraceErr(null);
    } catch (e) {
      setTraceErr(e instanceof Error ? e.message : 'Request failed');
      setTraceData(null);
    } finally {
      setTraceLoading(false);
    }
  }

  async function runSessionFetch() {
    const id = sessionId.trim();
    if (!id) return;
    setSessionLoading(true);
    setSessionErr(null);
    try {
      const res = await fetch(`/api/eb-langfuse/session/${encodeURIComponent(id)}`);
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          body &&
          typeof body === 'object' &&
          'error' in body &&
          typeof (body as { error: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `HTTP ${res.status}`;
        setSessionErr(msg);
        setSessionData(null);
        return;
      }
      setSessionData(body);
      setSessionErr(null);
    } catch (e) {
      setSessionErr(e instanceof Error ? e.message : 'Request failed');
      setSessionData(null);
    } finally {
      setSessionLoading(false);
    }
  }

  async function runAppFetch() {
    const id = appId.trim();
    if (!id) return;
    setAppLoading(true);
    setAppErr(null);
    try {
      const res = await fetch(`/api/mgmt/apps/${encodeURIComponent(id)}`);
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          body &&
          typeof body === 'object' &&
          'error' in body &&
          typeof (body as { error: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `HTTP ${res.status}`;
        setAppErr(msg);
        setAppData(null);
        return;
      }
      setAppData(body);
      setAppErr(null);
    } catch (e) {
      setAppErr(e instanceof Error ? e.message : 'Request failed');
      setAppData(null);
    } finally {
      setAppLoading(false);
    }
  }

  return (
    <div style={{ ...risqSectionDataPanel, width: '100%', boxSizing: 'border-box' }}>
      <div style={fullWidthFieldCol}>
        <div style={sectionLabel}>🔍 Customer Interaction Deep Dive (EB Langfuse)</div>
        <div style={traceSessionStack}>
          <div style={fullWidthFieldCol}>
            <label htmlFor="risq-lf-trace-id" style={label}>
              LANGFUSE TRACE ID
            </label>
            <input
              id="risq-lf-trace-id"
              type="text"
              autoComplete="off"
              value={traceId}
              onChange={function onTraceChange(ev: React.ChangeEvent<HTMLInputElement>) {
                setTraceId(ev.target.value);
              }}
              style={input}
            />
            <button
              type="button"
              style={{ ...btn, opacity: traceId.trim() ? 1 : 0.55, cursor: traceId.trim() ? 'pointer' : 'not-allowed' }}
              disabled={!traceId.trim() || traceLoading}
              onClick={function onTraceButtonClick() {
                void runTraceFetch();
              }}
            >
              {traceLoading ? 'Loading…' : 'Fetch trace'}
            </button>
            {traceErr ? <div style={errText}>{traceErr}</div> : null}
            {traceData != null ? <EbTraceDetailView data={traceData} /> : null}
          </div>
          <div style={fullWidthFieldCol}>
            <label htmlFor="risq-lf-session-id" style={label}>
              LANGFUSE SESSION ID
            </label>
            <input
              id="risq-lf-session-id"
              type="text"
              autoComplete="off"
              value={sessionId}
              onChange={function onSessionChange(ev: React.ChangeEvent<HTMLInputElement>) {
                setSessionId(ev.target.value);
              }}
              style={input}
            />
            <button
              type="button"
              style={{ ...btn, opacity: sessionId.trim() ? 1 : 0.55, cursor: sessionId.trim() ? 'pointer' : 'not-allowed' }}
              disabled={!sessionId.trim() || sessionLoading}
              onClick={function onSessionButtonClick() {
                void runSessionFetch();
              }}
            >
              {sessionLoading ? 'Loading…' : 'Fetch session'}
            </button>
            {sessionErr ? <div style={errText}>{sessionErr}</div> : null}
            {sessionData != null ? <EbSessionDetailView data={sessionData} /> : null}
          </div>
        </div>
      </div>

      <div style={{ marginTop: '1.15rem', paddingTop: '1rem', borderTop: '1px solid #e8ecf1', width: '100%', boxSizing: 'border-box' }}>
        <div style={blockTitle}>📱 Search by App ID</div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%', boxSizing: 'border-box' }}>
          <label htmlFor="risq-lf-app-id" style={label}>
            AIRO APP ID
          </label>
          <input
            id="risq-lf-app-id"
            type="text"
            autoComplete="off"
            value={appId}
            onChange={function onAppChange(ev: React.ChangeEvent<HTMLInputElement>) {
              setAppId(ev.target.value);
            }}
            style={{ ...input, width: '100%', maxWidth: '100%', marginBottom: 0 }}
          />
          <button
            type="button"
            style={{
              ...btn,
              marginTop: '0.55rem',
              alignSelf: 'flex-start',
              width: 'auto',
              padding: '0.35rem 0.7rem',
              fontSize: '0.74rem',
              borderRadius: 6,
              opacity: appId.trim() ? 1 : 0.55,
              cursor: appId.trim() ? 'pointer' : 'not-allowed',
            }}
            disabled={!appId.trim() || appLoading}
            onClick={function onAppButtonClick() {
              void runAppFetch();
            }}
          >
            {appLoading ? 'Loading…' : 'Fetch app details'}
          </button>
          <p style={{ ...caption, alignSelf: 'stretch', marginTop: '0.45rem', fontSize: '0.68rem' }}>
            Loads management API app record (composition, URLs, cell, domains, etc.).
          </p>
          {appErr ? <div style={errText}>{appErr}</div> : null}
          {appData != null ? <MgmtAppDetailView data={appData} /> : null}
        </div>
      </div>
    </div>
  );
}
