'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';

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

/**
 * Consecutive 401 count at which we escalate from debug to warn. agentFetch
 * already retries once with a fresh token, so 3 in a row at this layer means
 * ~6 actual round-trips have failed — likely a real auth failure (revoked
 * secret, alloc never provisioned, JWT/agent mismatch), not a hydration race.
 */
const PERSISTENT_401_WARN_THRESHOLD = 3;

export interface UseBrandDataOptions {
  /** Gate the fetch on app readiness. Defaults to true. */
  enabled?: boolean;
}

export function useBrandData(appId: string | undefined, options: UseBrandDataOptions = {}) {
  const { enabled = true } = options;
  const [data, setData] = useState<BrandData | null>(null);
  const [isLoading, setIsLoading] = useState(!!appId && enabled);
  const [error, setError] = useState<Error | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutive401Ref = useRef(0);

  const fetchBrandData = useCallback(async () => {
    if (!appId || !enabled) return;

    setIsLoading(true);
    setError(null);
    try {
      const url = await buildDynamicApiUrl('brand-data', appId);
      const response = await agentFetch(url, { siteId: appId });
      if (!response.ok) {
        setData(null);
        if (response.status === 401) {
          // 401 = agent doesn't recognize this app yet (creation/hydration in
          // progress). The BRAND_DATA_UPDATED_EVENT from completed brand tools
          // will retry once provisioned, so don't surface a hard failure — but
          // do leave a trail. Persistent 401s likely mean a real auth break,
          // not a race, so escalate to warn at the threshold.
          consecutive401Ref.current += 1;
          logger.debug('hook.brand_data.fetch.skip_401', {
            appId,
            attempt: consecutive401Ref.current,
          });
          if (consecutive401Ref.current === PERSISTENT_401_WARN_THRESHOLD) {
            logger.warn('hook.brand_data.fetch.persistent_401', {
              appId,
              attempts: consecutive401Ref.current,
            });
          }
          return;
        }
        consecutive401Ref.current = 0;
        const body = await response.text().catch(() => '<unreadable>');
        logger.warn('hook.brand_data.fetch.failure', {
          appId,
          status: response.status,
          statusText: response.statusText,
          body,
        });
        setError(new Error(`Failed to fetch brand data: ${response.status} ${response.statusText}`.trim()));
        return;
      }
      consecutive401Ref.current = 0;
      const json = await response.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [appId, enabled]);

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
