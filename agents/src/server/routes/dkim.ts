import { Router, Request, Response } from 'express';

import { validateAppOwnership } from '../middleware/app-ownership.js';
import { DkimOnboardingRepository } from '../../database/repositories/DkimOnboardingRepository.js';
import { Logger } from '../../logging/index.js';

const router: Router = Router();
const repo = new DkimOnboardingRepository();
const logger = Logger.create({ component: 'dkim-routes' });

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function requireDomain(req: Request, res: Response): string | null {
  const { domain } = (req.body ?? {}) as { domain?: unknown };
  if (!domain || typeof domain !== 'string') {
    res.status(400).json({ error: 'domain is required' });
    return null;
  }
  return domain.toLowerCase();
}

router.post('/apps/:id/dkim/claim', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id;
  if (!appId) { res.status(400).json({ error: 'App ID is required' }); return; }
  const domain = requireDomain(req, res);
  if (!domain) return;
  const result = repo.claim(appId, domain);
  logger.info('dkim.route.claim', { appId, domain, claimed: result.claimed });
  res.json(result);
});

router.post('/apps/:id/dkim/active', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id;
  if (!appId) { res.status(400).json({ error: 'App ID is required' }); return; }
  const domain = requireDomain(req, res);
  if (!domain) return;
  repo.markActive(appId, domain);
  logger.info('dkim.route.active', { appId, domain });
  res.json({ ok: true });
});

router.post('/apps/:id/dkim/poll/claim', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id;
  if (!appId) { res.status(400).json({ error: 'App ID is required' }); return; }
  const domain = requireDomain(req, res);
  if (!domain) return;
  const result = repo.claimDuePoll(appId, domain);
  logger.info('dkim.route.poll.claim', { appId, domain, shouldPoll: result.shouldPoll, expired: result.expired });
  res.json({
    shouldPoll: result.shouldPoll,
    expired: result.expired,
    status: result.status,
    pollStartedAt: toIso(result.pollStartedAt),
    nextPollAt: toIso(result.nextPollAt),
    lastPolledAt: toIso(result.lastPolledAt),
  });
});

router.post('/apps/:id/dkim/poll/complete', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id;
  if (!appId) { res.status(400).json({ error: 'App ID is required' }); return; }
  const domain = requireDomain(req, res);
  if (!domain) return;
  repo.completeDuePoll(appId, domain);
  logger.info('dkim.route.poll.complete', { appId, domain });
  res.json({ ok: true });
});

router.post('/apps/:id/dkim/accepted', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id;
  if (!appId) { res.status(400).json({ error: 'App ID is required' }); return; }
  const domain = requireDomain(req, res);
  if (!domain) return;
  const { executionArn } = (req.body ?? {}) as { executionArn?: unknown };
  if (!executionArn || typeof executionArn !== 'string') {
    res.status(400).json({ error: 'executionArn is required' });
    return;
  }
  repo.setAccepted(appId, domain, executionArn);
  logger.info('dkim.route.accepted', { appId, domain });
  res.json({ ok: true });
});

router.post('/apps/:id/dkim/failed', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id;
  if (!appId) { res.status(400).json({ error: 'App ID is required' }); return; }
  const domain = requireDomain(req, res);
  if (!domain) return;
  const { error } = (req.body ?? {}) as { error?: unknown };
  repo.setFailed(appId, domain, typeof error === 'string' ? error : 'unknown');
  logger.info('dkim.route.failed', { appId, domain });
  res.json({ ok: true });
});

router.get('/apps/:id/dkim', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id;
  if (!appId) { res.status(400).json({ error: 'App ID is required' }); return; }
  const rawDomain = req.query.domain;
  if (!rawDomain || typeof rawDomain !== 'string') {
    res.status(400).json({ error: 'domain query param is required' });
    return;
  }
  const domain = rawDomain.toLowerCase();
  const row = repo.findByAppDomain(appId, domain);
  logger.info('dkim.route.get', { appId, domain, found: !!row });
  res.json({
    createdAt: toIso(row?.createdAt),
    pollStartedAt: toIso(row?.pollStartedAt),
    nextPollAt: toIso(row?.nextPollAt),
    lastPolledAt: toIso(row?.lastPolledAt),
  });
});

router.delete('/apps/:id/dkim', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id;
  if (!appId) { res.status(400).json({ error: 'App ID is required' }); return; }
  const rawDomain = req.query.domain;
  if (!rawDomain || typeof rawDomain !== 'string') {
    res.status(400).json({ error: 'domain query param is required' });
    return;
  }
  const domain = rawDomain.toLowerCase();
  const ifStatusRaw = req.query.ifStatus;
  let expectedStatus: 'pending' | 'active' | 'failed' | undefined;
  if (typeof ifStatusRaw === 'string') {
    if (ifStatusRaw !== 'pending' && ifStatusRaw !== 'active' && ifStatusRaw !== 'failed') {
      res.status(400).json({ error: 'invalid ifStatus' });
      return;
    }
    expectedStatus = ifStatusRaw;
  }
  const deleted = repo.deleteByAppDomain(appId, domain, expectedStatus);
  logger.info('dkim.route.deleted', { appId, domain, expectedStatus: expectedStatus ?? null, deleted });
  res.json({ ok: true, deleted: deleted > 0 });
});

export default router;
