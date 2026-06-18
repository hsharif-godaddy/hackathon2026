import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRepo = vi.hoisted(() => ({
  claim: vi.fn(),
  setAccepted: vi.fn(),
  setFailed: vi.fn(),
  markActive: vi.fn(),
  deleteByAppDomain: vi.fn(),
  findByAppDomain: vi.fn(),
  claimDuePoll: vi.fn(),
  completeDuePoll: vi.fn(),
}));

vi.mock('../../../database/repositories/DkimOnboardingRepository.js', () => ({
  DkimOnboardingRepository: vi.fn().mockImplementation(function () { return mockRepo; }),
}));

vi.mock('../../../logging/index.js', () => ({
  Logger: { create: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import dkimRouter from '../dkim.js';

const VALID = 'aaaaaaaaaa';
const OTHER = 'bbbbbbbbbb';

// Inject agentContext.siteId (normally set by jwtAuthMiddleware) so the REAL
// validateAppOwnership middleware can compare it against :id.
const createTestApp = (siteId: string) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).agentContext = { siteId }; next(); });
  app.use(dkimRouter);
  return app;
};

describe('dkim routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET returns createdAt when row exists', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    mockRepo.findByAppDomain.mockReturnValue({
      id: 'dkim-abc', appId: VALID, domain: 'acme.com',
      status: 'active', executionArn: null, lastError: null,
      pollStartedAt: createdAt,
      nextPollAt: new Date('2026-01-01T00:00:30.000Z'),
      lastPolledAt: null,
      createdAt, updatedAt: createdAt,
    });
    const res = await request(createTestApp(VALID))
      .get(`/apps/${VALID}/dkim?domain=acme.com`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      createdAt: '2026-01-01T00:00:00.000Z',
      pollStartedAt: '2026-01-01T00:00:00.000Z',
      nextPollAt: '2026-01-01T00:00:30.000Z',
      lastPolledAt: null,
    });
    expect(mockRepo.findByAppDomain).toHaveBeenCalledWith(VALID, 'acme.com');
  });

  it('GET returns createdAt null when no row exists', async () => {
    mockRepo.findByAppDomain.mockReturnValue(null);
    const res = await request(createTestApp(VALID))
      .get(`/apps/${VALID}/dkim?domain=acme.com`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      createdAt: null,
      pollStartedAt: null,
      nextPollAt: null,
      lastPolledAt: null,
    });
  });

  it('GET 400s without a domain query param', async () => {
    const res = await request(createTestApp(VALID))
      .get(`/apps/${VALID}/dkim`);
    expect(res.status).toBe(400);
    expect(mockRepo.findByAppDomain).not.toHaveBeenCalled();
  });

  it('GET blocks cross-tenant access with 403', async () => {
    const res = await request(createTestApp(OTHER))
      .get(`/apps/${VALID}/dkim?domain=acme.com`);
    expect(res.status).toBe(403);
    expect(mockRepo.findByAppDomain).not.toHaveBeenCalled();
  });

  it('POST claim returns the repository result', async () => {
    mockRepo.claim.mockReturnValue({ claimed: true, status: 'pending' });
    const res = await request(createTestApp(VALID))
      .post(`/apps/${VALID}/dkim/claim`)
      .send({ domain: 'acme.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ claimed: true, status: 'pending' });
    expect(mockRepo.claim).toHaveBeenCalledWith(VALID, 'acme.com');
  });

  it('POST claim 400s without a domain', async () => {
    const res = await request(createTestApp(VALID)).post(`/apps/${VALID}/dkim/claim`).send({});
    expect(res.status).toBe(400);
    expect(mockRepo.claim).not.toHaveBeenCalled();
  });

  it('POST active calls markActive', async () => {
    const res = await request(createTestApp(VALID))
      .post(`/apps/${VALID}/dkim/active`)
      .send({ domain: 'acme.com' });
    expect(res.status).toBe(200);
    expect(mockRepo.markActive).toHaveBeenCalledWith(VALID, 'acme.com');
  });

  it('POST poll/claim returns durable due-poll decision', async () => {
    mockRepo.claimDuePoll.mockReturnValue({
      shouldPoll: true,
      expired: false,
      status: 'pending',
      pollStartedAt: new Date('2026-06-17T10:00:00.000Z'),
      nextPollAt: new Date('2026-06-17T10:02:00.000Z'),
      lastPolledAt: new Date('2026-06-17T10:00:00.000Z'),
    });

    const res = await request(createTestApp(VALID))
      .post(`/apps/${VALID}/dkim/poll/claim`)
      .send({ domain: 'acme.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      shouldPoll: true,
      expired: false,
      status: 'pending',
      pollStartedAt: '2026-06-17T10:00:00.000Z',
      nextPollAt: '2026-06-17T10:02:00.000Z',
      lastPolledAt: '2026-06-17T10:00:00.000Z',
    });
    expect(mockRepo.claimDuePoll).toHaveBeenCalledWith(VALID, 'acme.com');
  });

  it('POST poll/complete records the next scheduled poll after a successful check', async () => {
    const res = await request(createTestApp(VALID))
      .post(`/apps/${VALID}/dkim/poll/complete`)
      .send({ domain: 'acme.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockRepo.completeDuePoll).toHaveBeenCalledWith(VALID, 'acme.com');
  });

  it('POST accepted records the arn', async () => {
    const res = await request(createTestApp(VALID))
      .post(`/apps/${VALID}/dkim/accepted`)
      .send({ domain: 'acme.com', executionArn: 'arn:1' });
    expect(res.status).toBe(200);
    expect(mockRepo.setAccepted).toHaveBeenCalledWith(VALID, 'acme.com', 'arn:1');
  });

  it('POST failed records the error', async () => {
    const res = await request(createTestApp(VALID))
      .post(`/apps/${VALID}/dkim/failed`)
      .send({ domain: 'acme.com', error: 'boom' });
    expect(res.status).toBe(200);
    expect(mockRepo.setFailed).toHaveBeenCalledWith(VALID, 'acme.com', 'boom');
  });

  it('DELETE removes the row', async () => {
    mockRepo.deleteByAppDomain.mockReturnValue(1);
    const res = await request(createTestApp(VALID))
      .delete(`/apps/${VALID}/dkim?domain=acme.com`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, deleted: true });
    expect(mockRepo.deleteByAppDomain).toHaveBeenCalledWith(VALID, 'acme.com', undefined);
  });

  it('DELETE with ?ifStatus=active passes active to repo', async () => {
    mockRepo.deleteByAppDomain.mockReturnValue(1);
    const res = await request(createTestApp(VALID))
      .delete(`/apps/${VALID}/dkim?domain=acme.com&ifStatus=active`);
    expect(res.status).toBe(200);
    expect(mockRepo.deleteByAppDomain).toHaveBeenCalledWith(VALID, 'acme.com', 'active');
  });

  it('DELETE with invalid ?ifStatus=bogus returns 400', async () => {
    const res = await request(createTestApp(VALID))
      .delete(`/apps/${VALID}/dkim?domain=acme.com&ifStatus=bogus`);
    expect(res.status).toBe(400);
    expect(mockRepo.deleteByAppDomain).not.toHaveBeenCalled();
  });

  it('blocks cross-tenant access with 403', async () => {
    const res = await request(createTestApp(OTHER))
      .post(`/apps/${VALID}/dkim/claim`)
      .send({ domain: 'acme.com' });
    expect(res.status).toBe(403);
    expect(mockRepo.claim).not.toHaveBeenCalled();
  });

  it('POST active 400s without a domain', async () => {
    const res = await request(createTestApp(VALID))
      .post(`/apps/${VALID}/dkim/active`)
      .send({});
    expect(res.status).toBe(400);
    expect(mockRepo.markActive).not.toHaveBeenCalled();
  });

  it('POST accepted 400s without executionArn', async () => {
    const res = await request(createTestApp(VALID))
      .post(`/apps/${VALID}/dkim/accepted`)
      .send({ domain: 'acme.com' });
    expect(res.status).toBe(400);
    expect(mockRepo.setAccepted).not.toHaveBeenCalled();
  });

  it('POST accepted 400s without a domain', async () => {
    const res = await request(createTestApp(VALID))
      .post(`/apps/${VALID}/dkim/accepted`)
      .send({ executionArn: 'arn:1' });
    expect(res.status).toBe(400);
    expect(mockRepo.setAccepted).not.toHaveBeenCalled();
  });

  it('DELETE 400s without a domain query param', async () => {
    const res = await request(createTestApp(VALID))
      .delete(`/apps/${VALID}/dkim`);
    expect(res.status).toBe(400);
    expect(mockRepo.deleteByAppDomain).not.toHaveBeenCalled();
  });
});
