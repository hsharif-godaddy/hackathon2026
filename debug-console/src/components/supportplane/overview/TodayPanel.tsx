'use client';

import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';
import { WaveDots } from '@/components/supportplane/WaveDots';
import type { PanelId } from '@/components/supportplane/types';

interface TranscriptStats {
  today: number;
  yesterday: number;
  delta: number;
  error?: string;
}

interface FeedbackStats {
  today: number;
  yesterday: number;
  delta: number;
  sentiment: { positive: number; neutral: number; negative: number };
  error?: string;
}

interface TicketStats {
  open: number;
  resolved_today: number;
  p1_count: number;
  backlog_velocity: number;
  error?: string;
}

function KpiCard({ label, value, delta, alert, loading, error }: {
  label: string;
  value: number | string;
  delta?: number;
  alert?: boolean;
  loading?: boolean;
  error?: string;
}) {
  return (
    <div className={sp.kpiCard} data-alert={alert}>
      <div className={sp.kpiLabel}>{label}</div>
      {loading ? (
        <div style={{ marginTop: 6 }}><WaveDots size={6} /></div>
      ) : error ? (
        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }} title={error}>⚠ unavailable</div>
      ) : (
        <div className={sp.kpiValue}>
          {value}
          {delta !== undefined && delta !== 0 && (
            <span className={sp.kpiDelta} data-direction={delta > 0 ? 'up' : 'down'}>
              {delta > 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              {Math.abs(delta)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SentimentBar({ positive, neutral, negative }: { positive: number; neutral: number; negative: number }) {
  const total: number = positive + neutral + negative;
  if (total === 0) return <div className={sp.sentimentBar}><div style={{ width: '100%', background: '#555' }} /></div>;
  return (
    <div className={sp.sentimentBar}>
      <div style={{ width: `${(positive / total) * 100}%`, background: '#10b981' }} title={`Positive: ${positive}`} />
      <div style={{ width: `${(neutral / total) * 100}%`, background: '#6b7280' }} title={`Neutral: ${neutral}`} />
      <div style={{ width: `${(negative / total) * 100}%`, background: '#ef4444' }} title={`Negative: ${negative}`} />
    </div>
  );
}

function SectionError({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#ef4444', padding: '4px 0' }}>
      <AlertCircle size={12} />
      {message}
    </div>
  );
}

function SparkSkeleton() {
  return (
    <div style={{ padding: '8px 0' }}><WaveDots size={7} /></div>
  );
}

async function fetchSection<T>(url: string): Promise<T> {
  const res: Response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export default function TodayPanel({ onNav }: { onNav?: (id: PanelId) => void }) {
  const today: string = new Date().toISOString().split('T')[0]!;

  const [transcripts, setTranscripts] = useState<TranscriptStats | null>(null);
  const [transcriptsLoading, setTranscriptsLoading] = useState<boolean>(true);

  const [feedback, setFeedback] = useState<FeedbackStats | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState<boolean>(true);

  const [tickets, setTickets] = useState<TicketStats | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState<boolean>(true);

  useEffect(() => {
    void fetchSection<TranscriptStats>('/api/supportplane/today/transcripts')
      .then(setTranscripts)
      .catch((err: unknown) => setTranscripts({ today: 0, yesterday: 0, delta: 0, error: err instanceof Error ? err.message : String(err) }))
      .finally(() => setTranscriptsLoading(false));

    void fetchSection<FeedbackStats>('/api/supportplane/today/feedback')
      .then(setFeedback)
      .catch((err: unknown) => setFeedback({ today: 0, yesterday: 0, delta: 0, sentiment: { positive: 0, neutral: 0, negative: 0 }, error: err instanceof Error ? err.message : String(err) }))
      .finally(() => setFeedbackLoading(false));

    void fetchSection<TicketStats>('/api/supportplane/today/tickets')
      .then(setTickets)
      .catch((err: unknown) => setTickets({ open: 0, resolved_today: 0, p1_count: 0, backlog_velocity: 0, error: err instanceof Error ? err.message : String(err) }))
      .finally(() => setTicketsLoading(false));
  }, []);

  const hasP1Alert: boolean = !ticketsLoading && (tickets?.p1_count ?? 0) > 0 && !tickets?.error;
  const hasBacklogAlert: boolean = !ticketsLoading && (tickets?.backlog_velocity ?? 0) > 5 && !tickets?.error;

  return (
    <div className={sp.panelRoot}>
      <div className={sp.panelHeader}>
        <div>
          <div className={sp.panelTitle}>
            <span style={{ fontSize: 20, marginRight: 8 }}>🌅</span>
            TODAY — {new Date(today).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          <div className={sp.panelSub}>Cross-domain executive health snapshot</div>
        </div>
      </div>

      {/* Alert Banner — only shows once tickets load */}
      {(hasP1Alert || hasBacklogAlert) && (
        <div style={{
          display: 'flex', gap: 12, padding: 16,
          background: '#fee2e21a', border: '1px solid #ef444430',
          borderRadius: 10, marginBottom: 16, alignItems: 'flex-start',
        }}>
          <AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: 'var(--t1)' }}>
            {hasP1Alert && <div style={{ marginBottom: 4 }}><strong>⚠️ P1 Tickets:</strong> {tickets!.p1_count} open critical issues</div>}
            {hasBacklogAlert && <div><strong>📈 Backlog Growing:</strong> +{tickets!.backlog_velocity} net new tickets today</div>}
          </div>
        </div>
      )}

      {/* Top KPI Strip — each cell shows independently */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard
          label="L1 Transcripts Today"
          value={transcripts?.today ?? 0}
          delta={transcripts?.delta}
          loading={transcriptsLoading}
          error={transcripts?.error}
        />
        <KpiCard
          label="Feedback Today"
          value={feedback?.today ?? 0}
          delta={feedback?.delta}
          loading={feedbackLoading}
          error={feedback?.error}
        />
        <KpiCard label="Open Backlog" value={tickets?.open ?? 0} loading={ticketsLoading} error={tickets?.error} />
        <KpiCard label="Resolved Today" value={tickets?.resolved_today ?? 0} loading={ticketsLoading} error={tickets?.error} />
        <KpiCard label="P1 Count" value={tickets?.p1_count ?? 0} alert={(tickets?.p1_count ?? 0) > 0} loading={ticketsLoading} error={tickets?.error} />
        <KpiCard
          label="Backlog Velocity"
          value={(tickets?.backlog_velocity ?? 0) > 0 ? `+${tickets!.backlog_velocity}` : (tickets?.backlog_velocity ?? 0)}
          alert={(tickets?.backlog_velocity ?? 0) > 5}
          loading={ticketsLoading}
          error={tickets?.error}
        />
      </div>

      {/* Three Domain Spark Panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <div className={sp.card} style={{ cursor: 'pointer' }} onClick={() => onNav?.('dash-transcripts')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--blue)' }}>📋 L1 Transcripts</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--blue)' }}>
              {transcriptsLoading ? <WaveDots size={5} gap={3} /> : transcripts?.today ?? 0}
            </div>
          </div>
          {transcriptsLoading ? <SparkSkeleton /> : transcripts?.error ? (
            <SectionError message={transcripts.error} />
          ) : (
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
              {(transcripts?.delta ?? 0) >= 0 ? '+' : ''}{transcripts?.delta ?? 0} vs yesterday
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--t2)' }}>View full dashboard →</div>
        </div>

        <div className={sp.card} style={{ cursor: 'pointer' }} onClick={() => onNav?.('dash-feedback')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--purple)' }}>⭐ Feedback</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--purple)' }}>
              {feedbackLoading ? <WaveDots size={5} gap={3} /> : feedback?.today ?? 0}
            </div>
          </div>
          {feedbackLoading ? <SparkSkeleton /> : feedback?.error ? (
            <SectionError message={feedback.error} />
          ) : (
            <div style={{ marginBottom: 8 }}>
              <SentimentBar
                positive={feedback?.sentiment.positive ?? 0}
                neutral={feedback?.sentiment.neutral ?? 0}
                negative={feedback?.sentiment.negative ?? 0}
              />
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--t2)' }}>View full dashboard →</div>
        </div>

        <div className={sp.card} style={{ cursor: 'pointer' }} onClick={() => onNav?.('dash-tickets')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--amber)' }}>🎫 Support Tickets</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--amber)' }}>
              {ticketsLoading ? <WaveDots size={5} gap={3} /> : tickets?.open ?? 0}
            </div>
          </div>
          {ticketsLoading ? <SparkSkeleton /> : tickets?.error ? (
            <SectionError message={tickets.error} />
          ) : (
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
              {tickets?.resolved_today ?? 0} resolved today · {tickets?.p1_count ?? 0} P1 open
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--t2)' }}>View full dashboard →</div>
        </div>
      </div>

      {/* Sentiment Breakdown */}
      <div className={sp.card}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Feedback Sentiment Today</div>
        {feedbackLoading ? (
          <SparkSkeleton />
        ) : feedback?.error ? (
          <SectionError message={feedback.error} />
        ) : (
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <SentimentBar
                positive={feedback?.sentiment.positive ?? 0}
                neutral={feedback?.sentiment.neutral ?? 0}
                negative={feedback?.sentiment.negative ?? 0}
              />
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, background: '#10b981', borderRadius: 3 }} />
                Positive: {feedback?.sentiment.positive ?? 0}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, background: '#6b7280', borderRadius: 3 }} />
                Neutral: {feedback?.sentiment.neutral ?? 0}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, background: '#ef4444', borderRadius: 3 }} />
                Negative: {feedback?.sentiment.negative ?? 0}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
