'use client';

import { useEffect, useRef } from 'react';

import { dynamicApiConfigService } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logImpressionEvent } from '@/utils/instrumentation';

interface SeoQualityLatestResponse {
  regression: {
    isRegression: boolean;
    scoreDelta: number;
    regressions: Array<{ path: string; newIssues: string[] }>;
  } | null;
  latest: {
    id: string;
    score: number;
    pageScores: Record<string, number>;
    missingElements: Record<string, string[]>;
    isBaseline: boolean;
    triggeredBy: string;
    createdAt: string;
  } | null;
  previous: {
    id: string;
    score: number;
  } | null;
}

// Delay after publish before fetching — gives the server-side fire-and-forget audit time to finish.
const FETCH_DELAY_MS = 6000;

function storeSnapshotToS3(appId: string, data: SeoQualityLatestResponse): void {
  if (!data.latest) return;

  void fetch('/api/seo-quality/s3-store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: appId,
      snapshot_id: data.latest.id,
      score: data.latest.score,
      page_scores: JSON.stringify(data.latest.pageScores),
      missing_elements: JSON.stringify(data.latest.missingElements),
      triggered_by: data.latest.triggeredBy,
      is_baseline: data.latest.isBaseline,
      captured_utc_ts: data.latest.createdAt,
      score_delta: data.regression?.scoreDelta ?? null,
      affected_pages: data.regression?.regressions?.length ?? null,
      is_regression: data.regression?.isRegression ?? null,
    }),
    keepalive: true,
  }).catch((err: unknown) => {
    logger.warn('seo-quality-check.s3-store-failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

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
            previousScore: data.previous?.score ?? null,
            isRegression: data.regression?.isRegression ?? null,
            scoreDelta: data.regression?.scoreDelta ?? null,
            affectedPages: data.regression?.regressions?.length ?? 0,
          });

          if (!data.latest) {
            logger.info('seo-quality-check.no-snapshot', { appId, message: 'no snapshot in DB yet — first publish may still be capturing' });
            return;
          }

          // Write to S3 data lake regardless of baseline/regression status
          storeSnapshotToS3(appId, data);

          if (data.latest.isBaseline) {
            logger.info('seo-quality-check.baseline-created', {
              appId,
              score: data.latest.score,
              message: 'first publish — baseline created, no regression check',
            });
            logImpressionEvent('seo.quality.baseline', {
              id: data.latest.id,
              score: data.latest.score,
              pageScores: JSON.stringify(data.latest.pageScores),
              missingElements: JSON.stringify(data.latest.missingElements),
              triggeredBy: data.latest.triggeredBy,
              createdAt: data.latest.createdAt,
            })();
            return;
          }

          logImpressionEvent('seo.quality.snapshot', {
            id: data.latest.id,
            score: data.latest.score,
            pageScores: JSON.stringify(data.latest.pageScores),
            missingElements: JSON.stringify(data.latest.missingElements),
            triggeredBy: data.latest.triggeredBy,
            createdAt: data.latest.createdAt,
            scoreDelta: data.regression?.scoreDelta ?? 0,
            affectedPages: data.regression?.regressions?.length ?? 0,
            isRegression: data.regression?.isRegression ?? false,
          })();

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
            previousScore: data.previous?.score ?? null,
            affectedPages: data.regression.regressions.length,
            regressions: data.regression.regressions,
            message: 'regression detected — showing SEO quality alert',
          });

          logImpressionEvent('seo.quality.regression', {
            id: data.latest.id,
            score: data.latest.score,
            pageScores: JSON.stringify(data.latest.pageScores),
            missingElements: JSON.stringify(data.latest.missingElements),
            triggeredBy: data.latest.triggeredBy,
            createdAt: data.latest.createdAt,
            scoreDelta: data.regression.scoreDelta,
            affectedPages: data.regression.regressions.length,
          })();

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
