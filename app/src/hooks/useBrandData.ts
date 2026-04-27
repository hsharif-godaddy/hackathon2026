'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';

export type {
  BrandData,
  BrandDataAudience,
  BrandDataColors,
  BrandDataIconography,
  BrandDataLayout,
  BrandDataMission,
  BrandDataPalette,
  BrandDataPersonality,
  BrandDataPhotography,
  BrandDataToneMatrix,
  BrandDataTypography,
  BrandDataVoice,
} from '@airo/shared/brand-data'

import type { BrandData } from '@airo/shared/brand-data'

/** Custom event name dispatched by ToolResultHandler when brand-related tools complete */
export const BRAND_DATA_UPDATED_EVENT = 'brand-data-updated';

export function useBrandData(appId: string | undefined) {
  const [data, setData] = useState<BrandData | null>(null);
  const [isLoading, setIsLoading] = useState(!!appId);
  const [error, setError] = useState<Error | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBrandData = useCallback(async () => {
    if (!appId) return;

    setIsLoading(true);
    setError(null);
    try {
      const url = await buildDynamicApiUrl('brand-data', appId);
      const response = await agentFetch(url, { siteId: appId });
      if (!response.ok) {
        setData(null);
        setError(new Error(`Failed to fetch brand data: ${response.status} ${response.statusText}`.trim()));
        return;
      }
      const json = await response.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [appId]);

  const debouncedFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchBrandData, 500);
  }, [fetchBrandData]);

  // Fetch on mount and when appId changes
  useEffect(() => {
    fetchBrandData();
  }, [fetchBrandData]);

  // Listen for brand-data-updated events from WebSocket tool results
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      // Only refetch if the event is for this app (or has no appId, e.g. tool results)
      if (detail?.appId && detail.appId !== appId) return;
      debouncedFetch();
    };
    window.addEventListener(BRAND_DATA_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(BRAND_DATA_UPDATED_EVENT, handler);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [debouncedFetch, appId]);

  return { data, isLoading, error, refetch: fetchBrandData };
}
