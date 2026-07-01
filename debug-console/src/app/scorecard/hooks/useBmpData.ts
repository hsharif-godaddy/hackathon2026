'use client';

import type { ScorecardRange } from '../types';
import { useFetch } from './useFetch';

// ── Shared types ──────────────────────────────────────────────────────────────

export type BmpKV = { name: string; value: number };

export type BmpInterval = {
  startTime: string;
  endTime: string;
  intervalSummary: BmpKV[];
};

export type BmpMetric = {
  dimensions: BmpKV[];
  aggregatedSummary: BmpKV[];
  intervals: BmpInterval[];
};

export type ScorecardBmpFeedbackData = {
  configMissing: boolean;
  metrics?: BmpMetric[];
  error?: string;
};

export interface BmpQueryOptions {
  metricId:    string;
  namespace:   string;
  measures:    string[];
  period?:     'HOUR' | 'DAY' | 'WEEK' | 'MONTH';
  operation?:  'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
  dimensions?: string[];
}

// ── Shared helper ─────────────────────────────────────────────────────────────

export function bmpVal(kvs: BmpKV[] | null | undefined, name: string): number {
  return (kvs ?? []).find((k) => k.name === name)?.value ?? 0;
}

// ── Generic query hook ────────────────────────────────────────────────────────

export function useScorecardBmpQuery(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
  opts: BmpQueryOptions,
): { data: ScorecardBmpFeedbackData | null; loading: boolean; error: string | null } {
  const measuresParam: string = opts.measures.join(',');
  const periodParam: string   = opts.period    ?? 'WEEK';
  const opParam: string       = opts.operation ?? 'SUM';

  const dimsParam: string = (opts.dimensions ?? []).join(',');
  const dimsQuery: string = dimsParam ? `&dimensions=${encodeURIComponent(dimsParam)}` : '';
  const base: string = `action=bmp-feedback&metricId=${encodeURIComponent(opts.metricId)}&namespace=${encodeURIComponent(opts.namespace)}&measures=${encodeURIComponent(measuresParam)}&period=${periodParam}&operation=${opParam}${dimsQuery}`;

  const queryString: string | null = range === 'custom'
    ? (customFrom && customTo ? `${base}&range=custom&start=${customFrom}&end=${customTo}` : null)
    : `${base}&range=${range}`;

  return useFetch<ScorecardBmpFeedbackData>(queryString);
}

// ── Metric: agent_feedback_count (namespace: agent-observability) ─────────────
// positive_pct excluded — BMP returns a summed per-event contribution with SUM,
// not a 0-100 rate. Compute in the component: positive_count / total_count × 100

export function useBmpData(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
): { data: ScorecardBmpFeedbackData | null; loading: boolean; error: string | null } {
  return useScorecardBmpQuery(range, customFrom, customTo, {
    metricId:  'agent_feedback_count',
    namespace: 'agent-observability',
    measures:  ['positive_count', 'negative_count', 'total_count'],
    period:    'DAY',
    operation: 'SUM',
  });
}

// ── Metric: website_core_events (namespace: airo-instrumentation) ─────────────

export const WEBSITE_CORE_MEASURES: string[] = [
  'context_gathering_started',
  'context_gathering_completed',
  'initial_build_started',
  'initial_build_completed',
  'generation_triggered',
  'chat_start',
  'chat_complete',
  'chat_failed',
  'chat_submit',
  'chat_delete',
  'chat_reorder',
  'chat_undo',
  'edit_triggered',
  'rebuild_started',
  'inline_edit',
  'publish_attempt',
  'publish_failed',
  'first_publish_success',
  'republish_success',
  'publish_button_click',
  'prompt_stop',
];

// ── Metric: paywall_conversion_events (namespace: airo-instrumentation) ──────

export const PAYWALL_CONVERSION_MEASURES: string[] = [
  'paywall_view',
  'purchase_success', 'purchase_starter', 'purchase_professional', 'purchase_ultimate',
  'credits_purchase',
  'plan_cancellation', 'downgrade_scheduled', 'suspended_nonpayment',
  'upgrade_banner_view', 'upgrade_banner_click', 'upgrade_banner_dismiss',
];

export function useScorecardPaywallConversionEvents(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
): { data: ScorecardBmpFeedbackData | null; loading: boolean; error: string | null } {
  return useScorecardBmpQuery(range, customFrom, customTo, {
    metricId:  'paywall_conversion_events',
    namespace: 'airo-instrumentation',
    measures:  PAYWALL_CONVERSION_MEASURES,
    period:    'DAY',
    operation: 'SUM',
  });
}

// ── Metric: website_core_events (namespace: airo-instrumentation) ─────────────

export function useScorecardWebsiteCoreEvents(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
): { data: ScorecardBmpFeedbackData | null; loading: boolean; error: string | null } {
  return useScorecardBmpQuery(range, customFrom, customTo, {
    metricId:  'website_core_events',
    namespace: 'airo-instrumentation',
    measures:  WEBSITE_CORE_MEASURES,
    period:    'DAY',
    operation: 'SUM',
  });
}

// ── Metric: website_core_events broken down by dimension (one call per dim) ───
// Order matters: initial_build_started → initial_build_completed → publish_attempt → first_publish_success

export const WEBSITE_DIM_MEASURES: string[] = [
  'initial_build_started',
  'initial_build_completed',
  'publish_attempt',
  'first_publish_success',
];

export function useScorecardWebsiteByEntryPoint(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
): { data: ScorecardBmpFeedbackData | null; loading: boolean; error: string | null } {
  return useScorecardBmpQuery(range, customFrom, customTo, {
    metricId:   'website_core_events',
    namespace:  'airo-instrumentation',
    measures:   WEBSITE_DIM_MEASURES,
    period:     'DAY',
    operation:  'SUM',
    dimensions: ['entry_point'],
  });
}

export function useScorecardWebsiteByPlanType(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
): { data: ScorecardBmpFeedbackData | null; loading: boolean; error: string | null } {
  return useScorecardBmpQuery(range, customFrom, customTo, {
    metricId:   'website_core_events',
    namespace:  'airo-instrumentation',
    measures:   WEBSITE_DIM_MEASURES,
    period:     'DAY',
    operation:  'SUM',
    dimensions: ['plan_type'],
  });
}

export function useScorecardWebsiteByCreationSource(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
): { data: ScorecardBmpFeedbackData | null; loading: boolean; error: string | null } {
  return useScorecardBmpQuery(range, customFrom, customTo, {
    metricId:   'website_core_events',
    namespace:  'airo-instrumentation',
    measures:   WEBSITE_DIM_MEASURES,
    period:     'DAY',
    operation:  'SUM',
    dimensions: ['creation_source'],
  });
}

export function useScorecardWebsiteByIntent(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
): { data: ScorecardBmpFeedbackData | null; loading: boolean; error: string | null } {
  return useScorecardBmpQuery(range, customFrom, customTo, {
    metricId:   'website_core_events',
    namespace:  'airo-instrumentation',
    measures:   WEBSITE_DIM_MEASURES,
    period:     'DAY',
    operation:  'SUM',
    dimensions: ['intent_category'],
  });
}
