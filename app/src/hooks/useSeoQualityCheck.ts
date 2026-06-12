'use client';

import { useEffect, useRef } from 'react';

import { dynamicApiConfigService } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

interface SeoQualityLatestResponse {
  regression: {
    isRegression: boolean;
    scoreDelta: number;
    regressions: Array<{ path: string; newIssues: string[] }>;
  } | null;
  latest: {
    score: number;
    isBaseline: boolean;
    triggeredBy: string;
  } | null;
  baseline: {
    id: string;
    score: number;
  } | null;
}

// Delay after publish before fetching — conservative buffer for the server-side fire-and-forget
// audit to finish writing its snapshot. Not empirically measured; adjust if audits prove slower.
const FETCH_DELAY_MS = 6000;

export function useSeoQualityCheck(appId: string | null): void {
  const setSeoRegressionAlert = useDevelopPageStore((state) => state.setSeoRegressionAlert);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!appId) return;

    const handlePublishSnapshot = (event: Event): void => {
      const detail = (event as CustomEvent).detail as { appId: string } | undefined;
      if (!detail || detail.appId !== appId) return;

      logger.info('seo-quality-check.event-received', {
        appId,
        message: `publish-snapshot-request received, scheduling fetch in ${FETCH_DELAY_MS}ms`,
      });

      // Clear any pending fetch from a prior rapid republish before scheduling a new one
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        logger.info('seo-quality-check.timeout-cleared', { appId, message: 'cleared previous pending fetch' });
      }

      timeoutRef.current = setTimeout(async () => {
        timeoutRef.current = null;
        logger.info('seo-quality-check.fetch-start', { appId, message: 'fetching /seo-quality/latest' });

        try {
          const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);
          if (!apiConfig.agentUrl) {
            logger.info('seo-quality-check.no-agent-url', { appId, message: 'agentUrl not available, skipping' });
            return;
          }

          const url = `${apiConfig.agentUrl}/apps/${appId}/seo-quality/latest`;
          logger.info('seo-quality-check.fetching', { appId, url });

          const response = await agentFetch(url, { siteId: appId });

          logger.info('seo-quality-check.fetch-response', { appId, status: response.status, ok: response.ok });

          if (!response.ok) {
            logger.info('seo-quality-check.fetch-not-ok', { appId, status: response.status, message: 'non-200 response, skipping' });
            return;
          }

          const data: SeoQualityLatestResponse = await response.json();

          logger.info('seo-quality-check.data-received', {
            appId,
            latestScore: data.latest?.score ?? null,
            latestIsBaseline: data.latest?.isBaseline ?? null,
            baselineScore: data.baseline?.score ?? null,
            isRegression: data.regression?.isRegression ?? null,
            scoreDelta: data.regression?.scoreDelta ?? null,
            affectedPages: data.regression?.regressions?.length ?? 0,
          });

          if (!data.latest) {
            logger.info('seo-quality-check.no-snapshot', { appId, message: 'no snapshot in DB yet — first publish may still be capturing' });
            return;
          }

          if (data.latest.isBaseline) {
            logger.info('seo-quality-check.baseline-created', {
              appId,
              score: data.latest.score,
              message: 'first publish — baseline created, no regression check',
            });
            return;
          }

          if (!data.regression?.isRegression) {
            logger.info('seo-quality-check.no-regression', {
              appId,
              scoreDelta: data.regression?.scoreDelta ?? 0,
              message: 'score did not drop enough to trigger regression alert',
            });
            return;
          }

          logger.info('seo-quality-check.regression-detected', {
            appId,
            scoreDelta: data.regression.scoreDelta,
            currentScore: data.latest.score,
            baselineScore: data.baseline?.score ?? null,
            affectedPages: data.regression.regressions.length,
            regressions: data.regression.regressions,
            message: 'regression detected — showing SEO quality alert',
          });

          setSeoRegressionAlert(appId, {
            scoreDelta: data.regression.scoreDelta,
            currentScore: data.latest.score,
            regressions: data.regression.regressions,
          });
        } catch (err) {
          logger.warn('seo-quality-check.fetch-failed', {
            appId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }, FETCH_DELAY_MS);
    };

    window.addEventListener('publish-snapshot-request', handlePublishSnapshot);
    return () => {
      window.removeEventListener('publish-snapshot-request', handlePublishSnapshot);
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [appId, setSeoRegressionAlert]);
}
