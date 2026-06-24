'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { InsightRow } from '@/lib/supportplane/store/insights-client';

interface CalendarData {
  year: number;
  month: number;
  days: Array<{ date: string; count: number }>;
  dateRange: {
    min_date: string | null;
    max_date: string | null;
    total: number;
  };
}

interface AnalyticsData {
  total: number;
  by_category: Array<{ category: string; count: number }>;
  by_sentiment: Array<{ sentiment: string; count: number }>;
  top_tags: Array<{ tag: string; count: number }>;
  timeline: Array<{ date: string; count: number }>;
  by_resolution: Array<{ interaction_status: string; count: number }>;
  by_sub_intent: Array<{ name: string; count: number }>;
  by_friction_point: Array<{ name: string; count: number }>;
  by_product_line: Array<{ name: string; count: number }>;
  by_issue_resolution: Array<{ name: string; count: number }>;
  by_inbound_driver: Array<{ name: string; count: number }>;
  friction_category_heatmap: unknown[];
  friction_resolution_heatmap: unknown[];
  friction_intent_heatmap: unknown[];
}

interface BrowseData {
  transcripts: unknown[];
  tagging_active: boolean;
  pagination: {
    total: number;
    total_is_estimate: boolean;
    limit: number | null;
    offset: number | null;
    has_more: boolean;
  };
  filters: Record<string, unknown>;
}

interface SupportPlaneData {
  calendar: CalendarData | null;
  analytics: AnalyticsData | null;
  bugs: InsightRow[];
  features: InsightRow[];
  patterns: InsightRow[];
  browse: BrowseData | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  cachedInsightsDays: number; // Track how many days of insights are cached
}

interface SupportPlaneDataContextValue extends SupportPlaneData {
  refetch: () => Promise<void>;
  refetchAnalytics: () => Promise<void>;
  refetchInsights: (days?: number) => Promise<void>;
}

const SupportPlaneDataContext = createContext<SupportPlaneDataContextValue | null>(null);

export function useSupportPlaneData(): SupportPlaneDataContextValue {
  const context: SupportPlaneDataContextValue | null = useContext(SupportPlaneDataContext);
  if (!context) {
    throw new Error('useSupportPlaneData must be used within SupportPlaneDataProvider');
  }
  return context;
}

interface Props {
  children: React.ReactNode;
  startDate?: string;
  endDate?: string;
}

export function SupportPlaneDataProvider({ children, startDate, endDate }: Props) {
  const [data, setData] = useState<SupportPlaneData>({
    calendar: null,
    analytics: null,
    bugs: [],
    features: [],
    patterns: [],
    browse: null,
    loading: true,
    error: null,
    lastFetchedAt: null,
    cachedInsightsDays: 30, // Default cache window
  });

  const fetchAll = useCallback(async () => {
    setData(prev => ({ ...prev, loading: true, error: null }));

    // Each fetch gets an independent 90s timeout. Promise.allSettled ensures
    // that a slow or failed scan yields null rather than blocking loading: true forever.
    const t = (url: string): Promise<Response> =>
      fetch(url, { signal: AbortSignal.timeout(90_000) });

    async function safeJson<T>(result: PromiseSettledResult<Response>, fallback: T): Promise<T> {
      if (result.status === 'rejected') return fallback;
      const res: Response = result.value;
      if (!res.ok) return fallback;
      return res.json().catch(() => fallback) as Promise<T>;
    }

    try {
      const now: Date = new Date();
      const year: number = now.getFullYear();
      const month: number = now.getMonth() + 1;

      const defaultInsightsDays: number = 30;
      const cutoffDate: Date = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - defaultInsightsDays);
      const createdAfter: string = cutoffDate.toISOString();

      const defaultAnalyticsDays: number = 30;
      const analyticsStartDate: Date = new Date();
      analyticsStartDate.setDate(analyticsStartDate.getDate() - defaultAnalyticsDays);
      const defaultStartDate: string = analyticsStartDate.toISOString().split('T')[0]!;
      const defaultEndDate: string = new Date().toISOString().split('T')[0]!;

      const dateParams: URLSearchParams = new URLSearchParams();
      dateParams.append('start_date', startDate || defaultStartDate);
      dateParams.append('end_date', endDate || defaultEndDate);
      const dateQueryString: string = dateParams.toString();

      const [
        calendarResult,
        analyticsResult,
        bugsResult,
        featuresResult,
        patternsResult,
        browseResult,
      ] = await Promise.allSettled([
        t(`/api/supportplane/transcripts/calendar?year=${year}&month=${month}`),
        t(`/api/supportplane/transcripts/analytics${dateQueryString ? `?${dateQueryString}` : ''}`),
        t(`/api/supportplane/insights/bugs?created_after=${createdAfter}`),
        t(`/api/supportplane/insights/features?created_after=${createdAfter}`),
        t(`/api/supportplane/insights/patterns?created_after=${createdAfter}`),
        t('/api/supportplane/transcripts/browse?limit=50&offset=0'),
      ]);

      const [calendarData, analyticsData, bugsData, featuresData, patternsData, browseData] = await Promise.all([
        safeJson(calendarResult, null),
        safeJson(analyticsResult, null),
        safeJson(bugsResult, { bugs: [] as unknown[] }),
        safeJson(featuresResult, { features: [] as unknown[] }),
        safeJson(patternsResult, { patterns: [] as unknown[] }),
        safeJson(browseResult, null),
      ]);

      setData({
        calendar: calendarData,
        analytics: (analyticsData as { analytics?: AnalyticsData } | null)?.analytics ?? null,
        bugs: (bugsData as { bugs?: InsightRow[] } | null)?.bugs ?? [],
        features: (featuresData as { features?: InsightRow[] } | null)?.features ?? [],
        patterns: (patternsData as { patterns?: InsightRow[] } | null)?.patterns ?? [],
        browse: browseData,
        loading: false,
        error: null,
        lastFetchedAt: Date.now(),
        cachedInsightsDays: defaultInsightsDays,
      });
    } catch (error) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch data',
      }));
    }
  }, [startDate, endDate]);

  const refetchAnalytics = useCallback(async () => {
    try {
      const now: Date = new Date();
      const year: number = now.getFullYear();
      const month: number = now.getMonth() + 1;

      const dateParams: URLSearchParams = new URLSearchParams();
      if (startDate) dateParams.append('start_date', startDate);
      if (endDate) dateParams.append('end_date', endDate);
      const dateQueryString: string = dateParams.toString();

      const [calendarRes, analyticsRes] = await Promise.all([
        fetch(`/api/supportplane/transcripts/calendar?year=${year}&month=${month}`),
        fetch(`/api/supportplane/transcripts/analytics${dateQueryString ? `?${dateQueryString}` : ''}`),
      ]);

      const [calendarData, analyticsData] = await Promise.all([
        calendarRes.ok ? calendarRes.json() : null,
        analyticsRes.ok ? analyticsRes.json() : null,
      ]);

      setData(prev => ({
        ...prev,
        calendar: calendarData,
        analytics: analyticsData?.analytics || null,
        lastFetchedAt: Date.now(),
      }));
    } catch (error) {
      console.error('Failed to refetch analytics:', error);
    }
  }, [startDate, endDate]);

  const refetchInsights = useCallback(async (days?: number) => {
    try {
      // Use provided days or fall back to current cached window
      const daysToFetch: number = days || data.cachedInsightsDays;
      const cutoffDate: Date = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToFetch);
      const createdAfter: string = cutoffDate.toISOString();

      const [bugsRes, featuresRes, patternsRes] = await Promise.all([
        fetch(`/api/supportplane/insights/bugs?created_after=${createdAfter}`),
        fetch(`/api/supportplane/insights/features?created_after=${createdAfter}`),
        fetch(`/api/supportplane/insights/patterns?created_after=${createdAfter}`),
      ]);

      const [bugsData, featuresData, patternsData] = await Promise.all([
        bugsRes.ok ? bugsRes.json() : { bugs: [] },
        featuresRes.ok ? featuresRes.json() : { features: [] },
        patternsRes.ok ? patternsRes.json() : { patterns: [] },
      ]);

      setData(prev => ({
        ...prev,
        bugs: bugsData.bugs || [],
        features: featuresData.features || [],
        patterns: patternsData.patterns || [],
        lastFetchedAt: Date.now(),
        cachedInsightsDays: daysToFetch, // Update cached window
      }));
    } catch (error) {
      console.error('Failed to refetch insights:', error);
    }
  }, [data.cachedInsightsDays]);

  // Initial fetch on mount
  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const value: SupportPlaneDataContextValue = {
    ...data,
    refetch: fetchAll,
    refetchAnalytics,
    refetchInsights,
  };

  return (
    <SupportPlaneDataContext.Provider value={value}>
      {children}
    </SupportPlaneDataContext.Provider>
  );
}
