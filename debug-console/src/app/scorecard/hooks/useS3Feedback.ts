'use client';

import { useEffect, useState } from 'react';

import { RANGE_DAYS } from '@/lib/analytics/date-range';

export interface S3CommentRow {
  text: string;
  rating: number | null;
  ts: string | null;
  appId: string | null;
}

export interface S3AppRatingRow {
  appId: string;
  avg: number;
  count: number;
}

export interface ScorecardS3FeedbackData {
  configMissing: boolean;
  avgRating: number | null;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  distribution: Record<string, number>;
  dailyDistribution?: Record<string, Record<string, number>>;
  mergedTruncated: boolean;
  itemsLoaded?: number;
  itemsInWindow?: number;
  partitionErrors?: number;
  perAppRatings?: S3AppRatingRow[];
  categoryCounts?: Record<string, number>;
}

interface S3FeedbackState {
  data: ScorecardS3FeedbackData | null;
  loading: boolean;
  error: string | null;
  progress: { done: number; total: number } | null;
}

const IDLE: S3FeedbackState = { data: null, loading: false, error: null, progress: null };

export function useS3Feedback(
  range: string,
  customFrom: string,
  customTo: string,
  enabled: boolean = true,
): S3FeedbackState {
  const [state, setState] = useState<S3FeedbackState>(IDLE);

  const params = new URLSearchParams({ action: 'feedback-s3' });
  if (range === 'custom' && customFrom && customTo) {
    params.set('start', customFrom);
    params.set('end', customTo);
  } else {
    params.set('days', String(RANGE_DAYS[range] ?? 7));
  }
  const rangeReady = !(range === 'custom' && (!customFrom || !customTo));
  const qs: string | null = enabled && rangeReady ? params.toString() : null;

  useEffect(() => {
    if (!qs) { setState(IDLE); return; }

    setState({ data: null, loading: true, error: null, progress: null });

    const controller = new AbortController();

    const run = async (): Promise<void> => {
      let res: Response;
      try {
        res = await fetch(`/api/analytics/scorecard?${qs}`, { signal: controller.signal });
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          setState({ data: null, loading: false, error: (err as Error)?.message ?? 'fetch failed', progress: null });
        }
        return;
      }

      if (!res.ok || !res.body) {
        setState({ data: null, loading: false, error: `HTTP ${res.status}`, progress: null });
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let evt: Record<string, unknown>;
            try { evt = JSON.parse(line.slice(6)) as Record<string, unknown>; } catch { continue; }
            if (evt['type'] === 'progress') {
              setState((s) => ({ ...s, progress: { done: evt['done'] as number, total: evt['total'] as number } }));
            } else if (evt['type'] === 'result') {
              const { type: _t, ...data } = evt;
              setState({ data: data as unknown as ScorecardS3FeedbackData, loading: false, error: null, progress: null });
            } else if (evt['type'] === 'error') {
              setState({ data: null, loading: false, error: (evt['message'] as string) ?? 'unknown error', progress: null });
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          setState((s) => ({ ...s, loading: false, error: (err as Error)?.message ?? 'stream read failed' }));
        }
      }
    };

    const tid = setTimeout(() => { void run(); }, 0);
    return () => { clearTimeout(tid); controller.abort(); };
  }, [qs]);

  return state;
}
