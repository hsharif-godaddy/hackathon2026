import { Router, type IRouter } from 'express';
import { log, logger } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { SeoQualityRepository } from '../../database/repositories/SeoQualityRepository.js';
import { scoreAuditReport, detectRegressionFromSnapshot } from '../../services/SeoQualityScorer.js';
import type { PageIssues } from '../../services/SeoQualityScorer.js';
import { runSeoAudit } from '../../services/seo-audit.js';

const router: IRouter = Router();
const repo = new SeoQualityRepository();
const appRepo = new AppRepository();

// All routes here are scoped to a specific app — enforce ownership.
router.use('/apps/:id([a-z0-9]{10})', validateAppOwnership);

/**
 * GET /apps/:id/seo-quality/latest
 *
 * Returns the most recent quality snapshot plus regression status vs the previous snapshot.
 */
router.get('/apps/:id/seo-quality/latest', (req, res) => {
  const appId = req.params.id!;

  try {
    const recent = repo.findRecent(appId, 2);
    const latest = recent[0];
    if (!latest) {
      return res.status(404).json({ error: 'No SEO quality data yet for this app.' });
    }

    const previous = recent[1] ?? null;

    let regression = null;
    if (previous) {
      const currentMissing: PageIssues = JSON.parse(latest.missingElements);
      const currentPageScores = JSON.parse(latest.pageScores);
      regression = detectRegressionFromSnapshot(
        {
          score: latest.score,
          pageScores: currentPageScores,
          missingElements: currentMissing,
          pageCount: Object.keys(currentPageScores).length,
          pagesWithIssues: Object.keys(currentMissing).length,
        },
        previous,
      );
    }

    return res.json({
      latest: {
        id: latest.id,
        score: latest.score,
        pageScores: JSON.parse(latest.pageScores),
        missingElements: JSON.parse(latest.missingElements),
        triggeredBy: latest.triggeredBy,
        isBaseline: latest.isBaseline,
        createdAt: latest.createdAt,
      },
      previous: previous
        ? {
            id: previous.id,
            score: previous.score,
            createdAt: previous.createdAt,
          }
        : null,
      regression,
    });
  } catch (err) {
    logger.error('seo-quality.latest.error', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Failed to retrieve SEO quality data.' });
  }
});

/**
 * GET /apps/:id/seo-quality/history
 *
 * Returns the last 10 quality snapshots (newest first).
 */
router.get('/apps/:id/seo-quality/history', (req, res) => {
  const appId = req.params.id!;

  try {
    const snapshots = repo.findRecent(appId, 10);
    return res.json({
      history: snapshots.map(s => ({
        id: s.id,
        score: s.score,
        triggeredBy: s.triggeredBy,
        isBaseline: s.isBaseline,
        pagesWithIssues: Object.keys(JSON.parse(s.missingElements)).length,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    logger.error('seo-quality.history.error', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Failed to retrieve SEO quality history.' });
  }
});

/**
 * POST /apps/:id/seo-quality/capture
 *
 * Manually triggers the same SEO quality capture that runs after publish.
 * Useful for local testing when the publish flow is unavailable.
 * Runs an HTML audit when published_url is set in the database, source-only otherwise.
 */
router.post('/apps/:id/seo-quality/capture', async (req, res) => {
  const appId = req.params.id!;
  const contextLogger = log.forApp(appId);

  try {
    const app = appRepo.findById(appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found.' });
    }

    const publishedUrl = app.publishedUrl?.trim() || null;

    contextLogger.info('seo.quality.capture.start', { appId, publishedUrl });

    const report = await runSeoAudit({
      appId,
      appPath: app.path,
      includeSourceScan: true,
    });

    const result = scoreAuditReport(report);

    if (result.pageCount === 0) {
      contextLogger.warn('seo.quality.empty-report', { appId, reason: 'audit returned no pages' });
      return res.status(200).json({ message: 'Audit returned no pages — no snapshot saved.', result });
    }

    const previous = repo.findLatest(appId);
    const snapshot = repo.save({
      appId,
      score: result.score,
      pageScores: result.pageScores,
      missingElements: result.missingElements,
      triggeredBy: 'manual',
    });

    contextLogger.info('seo.quality.scored', {
      appId,
      snapshotId: snapshot.id,
      score: result.score,
      pageCount: result.pageCount,
      pagesWithIssues: result.pagesWithIssues,
      isBaseline: snapshot.isBaseline,
      triggeredBy: 'manual',
    });

    let regression = null;
    if (previous) {
      regression = detectRegressionFromSnapshot(result, previous);
      if (regression.isRegression) {
        contextLogger.warn('seo.quality.regression', {
          appId,
          currentScore: result.score,
          previousScore: previous.score,
          scoreDelta: regression.scoreDelta,
          affectedPages: regression.regressions,
        });
      }
    }

    return res.json({
      snapshot: {
        id: snapshot.id,
        score: snapshot.score,
        isBaseline: snapshot.isBaseline,
        triggeredBy: snapshot.triggeredBy,
      },
      result: {
        score: result.score,
        pageCount: result.pageCount,
        pagesWithIssues: result.pagesWithIssues,
        pageScores: result.pageScores,
        missingElements: result.missingElements,
      },
      previous: previous ? { id: previous.id, score: previous.score } : null,
      regression,
    });
  } catch (err) {
    logger.error('seo-quality.capture.error', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Failed to capture SEO quality.', details: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
