'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface FeedbackByAppRow {
  feedbackId: string;
  feedbackUtcTs?: string;
  appId?: string;
  customerId?: string;
  shopperId?: string;
  rating?: number;
  comment?: string;
  consent?: boolean;
  origin?: string;
  category?: string;
  topics: string[];
  experimentsLine?: string;
  planTypeName?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  subscriptionInfo?: string;
  totalCredits?: number;
  availableCredits?: number;
  appPublishFlag?: boolean;
  publishUrl?: string;
  previewUrl?: string;
  publishedUrlFull?: string;
  fullStoryUrl?: string;
}

interface FeedbacksApiResponse {
  items: FeedbackByAppRow[];
  merged_truncated: boolean;
  total: number;
  avgRating: number | null;
  partition_errors: number;
  error?: string;
}

interface Props {
  appId: string | null;
  initialFeedbackId: string | null;
  onFeedbackIdChange?: (feedbackId: string | null) => void;
  refreshKey: number;
  onRefresh?: () => void;
}

const RATING_META: Record<number, { emoji: string; label: string; color: string }> = {
  1: { emoji: '🚨', label: 'Very negative', color: '#991b1b' },
  2: { emoji: '😡', label: 'Negative', color: '#b91c1c' },
  3: { emoji: '😕', label: 'Somewhat negative', color: '#c2410c' },
  4: { emoji: '😐', label: 'Neutral', color: '#92400e' },
  5: { emoji: '🙂', label: 'Positive', color: '#15803d' },
  6: { emoji: '😄', label: 'Very positive', color: '#15803d' },
  7: { emoji: '🤩', label: 'Extremely positive', color: '#15803d' },
};

function formatRating(rating: number | undefined): { emoji: string; label: string; color: string } {
  if (rating == null || !Number.isFinite(rating)) {
    return { emoji: '—', label: 'No score', color: '#6b7280' };
  }
  const meta = RATING_META[rating];
  if (meta) return meta;
  return { emoji: '❓', label: String(rating), color: '#6b7280' };
}

function formatUtc(ts: string | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

const CATEGORY_STYLES: Record<string, { bg: string; fg: string }> = {
  feedback: { bg: '#dbeafe', fg: '#1d4ed8' },
  issue: { bg: '#fee2e2', fg: '#991b1b' },
  support: { bg: '#fef3c7', fg: '#92400e' },
};

function CategoryChip({ category }: { category: string | undefined }) {
  if (!category) return <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span>;
  const palette = CATEGORY_STYLES[category] ?? { bg: '#f3f4f6', fg: '#374151' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.1rem 0.5rem',
        backgroundColor: palette.bg,
        color: palette.fg,
        borderRadius: '9999px',
        fontSize: '0.7rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {category}
    </span>
  );
}

interface ExperimentEntry {
  url: string;
  name: string;
  variant: string;
}

function parseExperiments(raw: string | undefined): ExperimentEntry[] {
  if (!raw) return [];
  // BFF pre-renders Slack mrkdwn link syntax: `<URL|name>: variant`,
  // separated by commas or newlines depending on origin. Stop the variant
  // capture at the next `,` `\n` or `<` so adjacent entries don't bleed.
  const re = /<([^|>]+)\|([^>]+)>:\s*([^,\n<]+)/g;
  const out: ExperimentEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.push({ url: m[1].trim(), name: m[2].trim(), variant: m[3].trim() });
  }
  return out;
}

export default function FeedbacksPanel({ appId, initialFeedbackId, onFeedbackIdChange, refreshKey, onRefresh }: Props) {
  const [data, setData] = useState<FeedbacksApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(initialFeedbackId);
  const initialFocusAppliedRef = useRef(false);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // Track the in-flight request so a rapid app switch (App A → App B before
  // App A's fetch resolves) doesn't render App A's rows under App B's header.
  // The effect's cleanup aborts the previous fetch; AbortError is swallowed
  // silently since it represents intentional cancellation, not user-visible
  // failure.
  const fetchList = useCallback(async (signal?: AbortSignal) => {
    if (!appId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // refreshKey bumps trigger a force=1 bypass of the 180s route cache +
      // 120s in-process item cache. Initial mount uses the cache.
      const force = (refreshKey ?? 0) > 0 ? '&force=1' : '';
      const res = await fetch(
        `/api/feedback/recent?appId=${encodeURIComponent(appId)}${force}`,
        { cache: 'no-store', signal },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setData(json as FeedbacksApiResponse);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      // The aborted branch returns early above without touching loading,
      // which is correct — a fresh fetch is already in flight.
      if (!signal?.aborted) setLoading(false);
    }
  }, [appId, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetchList(controller.signal);
    return () => controller.abort();
  }, [fetchList]);

  // Once data lands, auto-expand and scroll to the deep-linked feedback (one-shot).
  useEffect(() => {
    if (initialFocusAppliedRef.current) return;
    if (!initialFeedbackId || !data?.items?.length) return;
    const match = data.items.find((row) => row.feedbackId === initialFeedbackId);
    if (!match) {
      initialFocusAppliedRef.current = true;
      return;
    }
    setExpandedId(match.feedbackId);
    initialFocusAppliedRef.current = true;
    requestAnimationFrame(() => {
      const node = rowRefs.current[match.feedbackId];
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }, [data, initialFeedbackId]);

  const headerStats = useMemo(() => {
    if (!data) return null;
    return {
      total: data.total,
      avg: data.avgRating != null ? data.avgRating.toFixed(2) : '—',
      truncated: data.merged_truncated,
    };
  }, [data]);

  if (!appId) {
    return (
      <div style={{ padding: '1rem', color: '#6b7280' }}>
        Enter an App ID above to see feedback.
      </div>
    );
  }

  const initialFeedbackMissing =
    initialFeedbackId &&
    data?.items != null &&
    !data.items.some((row) => row.feedbackId === initialFeedbackId);

  return (
    <div style={{ padding: '0 0.25rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.5rem 0.75rem',
          marginBottom: '0.75rem',
          backgroundColor: '#f9fafb',
          borderRadius: '6px',
          fontSize: '0.85rem',
        }}
      >
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'baseline' }}>
          <strong style={{ color: '#374151' }}>Feedback (last 90 days)</strong>
          {headerStats && (
            <>
              <span style={{ color: '#6b7280' }}>
                Count: <strong style={{ color: '#111827' }}>{headerStats.total}</strong>
              </span>
              <span style={{ color: '#6b7280' }}>
                Avg rating: <strong style={{ color: '#111827' }}>{headerStats.avg}</strong>
                {data?.avgRating != null ? ' / 7' : ''}
              </span>
              {headerStats.truncated && (
                <span style={{ color: '#92400e' }}>(truncated to 2000)</span>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          style={{
            padding: '0.375rem 0.875rem',
            backgroundColor: loading ? '#9ca3af' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '0.813rem',
            fontWeight: 500,
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '0.75rem',
            backgroundColor: '#fef2f2',
            color: '#991b1b',
            borderRadius: '4px',
            marginBottom: '0.75rem',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {initialFeedbackMissing && (
        <div
          style={{
            padding: '0.5rem 0.75rem',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            borderRadius: '4px',
            marginBottom: '0.75rem',
            fontSize: '0.813rem',
          }}
        >
          Feedback <code>{initialFeedbackId}</code> not found in the last 90 days for this app.
        </div>
      )}

      {data && data.items.length === 0 && !loading && !error && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', fontSize: '0.9rem' }}>
          No feedback found for this app in the last 90 days.
        </div>
      )}

      {data && data.items.length > 0 && (
        <div style={{ overflowX: 'auto', backgroundColor: 'white', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>When (UTC)</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Rating</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Category</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Origin</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Comment</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const isExpanded = expandedId === row.feedbackId;
                const rating = formatRating(row.rating);
                const toggle = () => {
                  const next = isExpanded ? null : row.feedbackId;
                  setExpandedId(next);
                  onFeedbackIdChange?.(next);
                };
                return (
                  <React.Fragment key={row.feedbackId}>
                    <tr
                      ref={(el) => {
                        rowRefs.current[row.feedbackId] = el;
                      }}
                      role="button"
                      tabIndex={0}
                      onClick={toggle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle();
                        }
                      }}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        cursor: 'pointer',
                        backgroundColor: isExpanded ? '#eff6ff' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap', color: '#374151', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                        {formatUtc(row.feedbackUtcTs)}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap', color: rating.color, fontWeight: 600 }}>
                        {rating.emoji} {row.rating ?? '—'}/7
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>
                        <CategoryChip category={row.category} />
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#4b5563', fontSize: '0.8rem' }}>
                        {row.origin ?? '—'}
                      </td>
                      <td
                        style={{
                          padding: '0.5rem 0.75rem',
                          color: '#111827',
                          maxWidth: '420px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={row.comment ?? undefined}
                      >
                        {row.comment || <span style={{ color: '#9ca3af' }}>(no comment)</span>}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} style={{ padding: '0.75rem 1rem', backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          <FeedbackDetail row={row} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface DetailField {
  label: string;
  value: React.ReactNode;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div
        style={{
          fontSize: '0.7rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: '#6b7280',
          fontWeight: 600,
          borderBottom: '1px solid #e5e7eb',
          paddingBottom: '0.25rem',
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function DetailList({ fields }: { fields: DetailField[] }) {
  return (
    <dl
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        rowGap: '0.25rem',
        columnGap: '1rem',
        fontSize: '0.85rem',
      }}
    >
      {fields.map((field) => (
        <React.Fragment key={field.label}>
          <dt style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{field.label}</dt>
          <dd style={{ margin: 0, color: '#111827', wordBreak: 'break-word' }}>{field.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function ExperimentsBlock({ raw }: { raw: string }) {
  const entries = parseExperiments(raw);
  if (entries.length === 0) {
    // Fallback: show the raw line so info isn't lost when the format changes.
    return (
      <div style={{ fontSize: '0.8rem', color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{raw}</div>
    );
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {entries.map((exp) => (
        <li
          key={exp.name}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
            fontSize: '0.85rem',
            padding: '0.25rem 0',
            borderBottom: '1px dashed #e5e7eb',
          }}
        >
          <a
            href={exp.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#1d4ed8', textDecoration: 'none', fontFamily: 'monospace' }}
          >
            {exp.name} ↗
          </a>
          <span
            style={{
              padding: '0.1rem 0.5rem',
              backgroundColor: '#eef2ff',
              color: '#3730a3',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 600,
              fontFamily: 'monospace',
            }}
          >
            {exp.variant}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FeedbackDetail({ row }: { row: FeedbackByAppRow }) {
  const identifiers: DetailField[] = [
    { label: 'Feedback ID', value: <code>{row.feedbackId}</code> },
    { label: 'Subscription ID', value: row.subscriptionId ? <code>{row.subscriptionId}</code> : '—' },
  ];

  const subscription: DetailField[] = [
    { label: 'Plan', value: row.subscriptionInfo || row.planTypeName || '—' },
    { label: 'Status', value: row.subscriptionStatus ?? '—' },
  ];

  const context: DetailField[] = [
    { label: 'Customer Consent', value: row.consent == null ? '—' : row.consent ? 'Yes' : 'No' },
    { label: 'App Published', value: row.appPublishFlag == null ? '—' : row.appPublishFlag ? 'Yes' : 'No' },
  ];

  const links: Array<{ label: string; url: string }> = [];
  if (row.previewUrl) links.push({ label: 'Preview', url: row.previewUrl });
  if (row.publishedUrlFull) links.push({ label: 'Published', url: row.publishedUrlFull });
  if (row.publishUrl && row.publishUrl !== row.publishedUrlFull) {
    links.push({ label: 'Publish URL', url: row.publishUrl });
  }
  if (row.fullStoryUrl) links.push({ label: 'FullStory', url: row.fullStoryUrl });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {(row.comment || row.topics.length > 0) && (
        <DetailSection title="Comment">
          {row.comment && (
            <div
              style={{
                whiteSpace: 'pre-wrap',
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '4px',
                padding: '0.625rem 0.75rem',
                fontSize: '0.875rem',
                color: '#111827',
              }}
            >
              {row.comment}
            </div>
          )}
          {row.topics.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
              {row.topics.map((topic) => (
                <span
                  key={topic}
                  style={{
                    display: 'inline-block',
                    padding: '0.1rem 0.5rem',
                    backgroundColor: '#e0e7ff',
                    color: '#3730a3',
                    borderRadius: '9999px',
                    fontSize: '0.72rem',
                    fontWeight: 500,
                  }}
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </DetailSection>
      )}

      <DetailSection title="Identifiers">
        <DetailList fields={identifiers} />
      </DetailSection>

      <DetailSection title="Subscription">
        <DetailList fields={subscription} />
      </DetailSection>

      <DetailSection title="Context">
        <DetailList fields={context} />
      </DetailSection>

      {row.experimentsLine && (
        <DetailSection title="Experiments">
          <ExperimentsBlock raw={row.experimentsLine} />
        </DetailSection>
      )}

      {links.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.25rem' }}>
          {links.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '0.25rem 0.625rem',
                backgroundColor: 'white',
                border: '1px solid #d1d5db',
                color: '#1d4ed8',
                borderRadius: '4px',
                fontSize: '0.8rem',
                textDecoration: 'none',
              }}
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
