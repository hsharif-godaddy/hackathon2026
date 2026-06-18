'use client';

import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import sp from './sp.module.css';
import type { PanelId } from './types';

interface TodayStats {
  date: string;
  transcripts: {
    today: number;
    yesterday: number;
    delta: number;
  };
  feedback: {
    today: number;
    yesterday: number;
    delta: number;
    sentiment: {
      positive: number;
      neutral: number;
      negative: number;
    };
  };
  support: {
    open: number;
    resolved_today: number;
    p1_count: number;
    backlog_velocity: number;
  };
}

function KpiCard({ label, value, delta, alert }: { label: string; value: number | string; delta?: number; alert?: boolean }) {
  return (
    <div className={sp.kpiCard} data-alert={alert}>
      <div className={sp.kpiLabel}>{label}</div>
      <div className={sp.kpiValue}>
        {value}
        {delta !== undefined && delta !== 0 && (
          <span className={sp.kpiDelta} data-direction={delta > 0 ? 'up' : 'down'}>
            {delta > 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
            {Math.abs(delta)}
          </span>
        )}
      </div>
    </div>
  );
}

function SentimentBar({ positive, neutral, negative }: { positive: number; neutral: number; negative: number }) {
  const total = positive + neutral + negative;
  if (total === 0) return <div className={sp.sentimentBar}><div style={{ width: '100%', background: '#555' }} /></div>;

  const positivePct = (positive / total) * 100;
  const neutralPct = (neutral / total) * 100;
  const negativePct = (negative / total) * 100;

  return (
    <div className={sp.sentimentBar}>
      <div style={{ width: `${positivePct}%`, background: '#10b981' }} title={`Positive: ${positive}`} />
      <div style={{ width: `${neutralPct}%`, background: '#6b7280' }} title={`Neutral: ${neutral}`} />
      <div style={{ width: `${negativePct}%`, background: '#ef4444' }} title={`Negative: ${negative}`} />
    </div>
  );
}

export default function TodayPanel({ onNav }: { onNav?: (id: PanelId) => void }) {
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/supportplane/today');
        if (!res.ok) throw new Error('Failed to load today stats');
        const data = await res.json() as TodayStats;
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className={sp.panel}>
        <div className={sp.panelHeader}>
          <h2>TODAY</h2>
          <p>Cross-domain executive view</p>
        </div>
        <div className={sp.panelBody}>
          <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className={sp.panel}>
        <div className={sp.panelHeader}>
          <h2>TODAY</h2>
        </div>
        <div className={sp.panelBody}>
          <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>
            Error: {error ?? 'No data'}
          </div>
        </div>
      </div>
    );
  }

  const hasP1Alert = stats.support.p1_count > 0;
  const hasBacklogAlert = stats.support.backlog_velocity > 5;

  return (
    <div className={sp.panelRoot}>
      <div className={sp.panelHeader}>
        <div>
          <div className={sp.panelTitle}>
            <span style={{ fontSize: 20, marginRight: 8 }}>🌅</span>
            TODAY — {new Date(stats.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          <div className={sp.panelSub}>Cross-domain executive health snapshot</div>
        </div>
      </div>

      {/* Alert Banner */}
      {(hasP1Alert || hasBacklogAlert) && (
        <div style={{
          display: 'flex',
          gap: 12,
          padding: 16,
          background: '#fee2e21a',
          border: '1px solid #ef444430',
          borderRadius: 10,
          marginBottom: 16,
          alignItems: 'flex-start',
        }}>
          <AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: 'var(--t1)' }}>
            {hasP1Alert && <div style={{ marginBottom: 4 }}><strong>⚠️ P1 Tickets:</strong> {stats.support.p1_count} open critical issues</div>}
            {hasBacklogAlert && <div><strong>📈 Backlog Growing:</strong> +{stats.support.backlog_velocity} net new tickets today</div>}
          </div>
        </div>
      )}

      {/* Top KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard
          label="L1 Transcripts Today"
          value={stats.transcripts.today}
          delta={stats.transcripts.delta}
        />
        <KpiCard
          label="Feedback Today"
          value={stats.feedback.today}
          delta={stats.feedback.delta}
        />
        <KpiCard
          label="Open Backlog"
          value={stats.support.open}
        />
        <KpiCard
          label="Resolved Today"
          value={stats.support.resolved_today}
        />
        <KpiCard
          label="P1 Count"
          value={stats.support.p1_count}
          alert={stats.support.p1_count > 0}
        />
        <KpiCard
          label="Backlog Velocity"
          value={stats.support.backlog_velocity > 0 ? `+${stats.support.backlog_velocity}` : stats.support.backlog_velocity}
          alert={stats.support.backlog_velocity > 5}
        />
      </div>

      {/* Three Domain Spark Panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {/* L1 Transcripts Spark */}
        <div className={sp.card} style={{ cursor: 'pointer' }} onClick={() => onNav?.('dash-transcripts')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--blue)' }}>📋 L1 Transcripts</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--blue)' }}>{stats.transcripts.today}</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
            {stats.transcripts.delta >= 0 ? '+' : ''}{stats.transcripts.delta} vs yesterday
          </div>
          <div style={{ fontSize: 11, color: 'var(--t2)' }}>
            View full dashboard →
          </div>
        </div>

        {/* Feedback Spark */}
        <div className={sp.card} style={{ cursor: 'pointer' }} onClick={() => onNav?.('dash-feedback')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--purple)' }}>⭐ Feedback</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--purple)' }}>{stats.feedback.today}</div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <SentimentBar
              positive={stats.feedback.sentiment.positive}
              neutral={stats.feedback.sentiment.neutral}
              negative={stats.feedback.sentiment.negative}
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--t2)' }}>
            View full dashboard →
          </div>
        </div>

        {/* Support Tickets Spark */}
        <div className={sp.card} style={{ cursor: 'pointer' }} onClick={() => onNav?.('dash-tickets')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--amber)' }}>🎫 Support Tickets</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--amber)' }}>{stats.support.open}</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
            {stats.support.resolved_today} resolved today · {stats.support.p1_count} P1 open
          </div>
          <div style={{ fontSize: 11, color: 'var(--t2)' }}>
            View full dashboard →
          </div>
        </div>
      </div>

      {/* Sentiment Breakdown */}
      <div className={sp.card}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Feedback Sentiment Today</div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <SentimentBar
              positive={stats.feedback.sentiment.positive}
              neutral={stats.feedback.sentiment.neutral}
              negative={stats.feedback.sentiment.negative}
            />
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, background: '#10b981', borderRadius: 3 }} />
              Positive: {stats.feedback.sentiment.positive}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, background: '#6b7280', borderRadius: 3 }} />
              Neutral: {stats.feedback.sentiment.neutral}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, background: '#ef4444', borderRadius: 3 }} />
              Negative: {stats.feedback.sentiment.negative}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
