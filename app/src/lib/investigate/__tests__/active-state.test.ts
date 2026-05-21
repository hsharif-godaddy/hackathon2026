import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();
const transformToString = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  GetObjectCommand: vi.fn().mockImplementation((args) => ({ args })),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ORIGINAL_BUCKET = process.env.INVESTIGATE_BUCKET;

describe('readActiveState + isInvestigationActive', () => {
  beforeEach(() => {
    process.env.INVESTIGATE_BUCKET = 'airo-investigations-test';
    sendMock.mockReset();
    transformToString.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_BUCKET == null) delete process.env.INVESTIGATE_BUCKET;
    else process.env.INVESTIGATE_BUCKET = ORIGINAL_BUCKET;
  });

  it('returns null when INVESTIGATE_BUCKET is unset', async () => {
    delete process.env.INVESTIGATE_BUCKET;
    const { readActiveState } = await import('../active-state');
    const snap = await readActiveState('cust', 'app');
    expect(snap).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns null on NoSuchKey without warning', async () => {
    const err = Object.assign(new Error('not found'), { name: 'NoSuchKey' });
    sendMock.mockRejectedValueOnce(err);
    const { readActiveState } = await import('../active-state');
    const snap = await readActiveState('cust', 'app');
    expect(snap).toBeNull();
  });

  it('parses Lambda-written state with ISO heartbeatAt + startedAt', async () => {
    // Schema match for what investigator/handler.mjs:mergeState writes — both
    // timestamps as ISO strings, status 'running'.
    const lambdaState = {
      investigationId: 'inv-2026-05-20-abc',
      appId: 'app-1',
      customerId: 'cust-1',
      status: 'running',
      phase: 'claude-analysis',
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      heartbeatAt: new Date(Date.now() - 5_000).toISOString(),
      crmCaseId: 'airo-app-1-1700000000000',
    };
    transformToString.mockResolvedValueOnce(JSON.stringify(lambdaState));
    sendMock.mockResolvedValueOnce({ Body: { transformToString } });
    const { readActiveState, isInvestigationActive } = await import('../active-state');
    const snap = await readActiveState('cust-1', 'app-1');
    expect(snap).not.toBeNull();
    expect(snap?.investigationId).toBe('inv-2026-05-20-abc');
    expect(snap?.status).toBe('running');
    expect(snap?.crmCaseId).toBe('airo-app-1-1700000000000');
    // The lock check must agree the run is in flight.
    expect(isInvestigationActive(snap)).toBe(true);
  });

  it('treats stale heartbeat (>15min) as inactive', async () => {
    const stale = {
      investigationId: 'inv-old',
      status: 'running',
      startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      heartbeatAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    };
    transformToString.mockResolvedValueOnce(JSON.stringify(stale));
    sendMock.mockResolvedValueOnce({ Body: { transformToString } });
    const { readActiveState, isInvestigationActive } = await import('../active-state');
    const snap = await readActiveState('c', 'a');
    expect(isInvestigationActive(snap)).toBe(false);
  });

  it('rejects terminal statuses', async () => {
    const completed = {
      investigationId: 'inv-done',
      status: 'completed',
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    };
    transformToString.mockResolvedValueOnce(JSON.stringify(completed));
    sendMock.mockResolvedValueOnce({ Body: { transformToString } });
    const { readActiveState, isInvestigationActive } = await import('../active-state');
    const snap = await readActiveState('c', 'a');
    expect(isInvestigationActive(snap)).toBe(false);
  });

  it('falls back to startedAt when heartbeat absent', async () => {
    const justStarted = {
      investigationId: 'inv-fresh',
      status: 'running',
      startedAt: new Date(Date.now() - 1000).toISOString(),
    };
    transformToString.mockResolvedValueOnce(JSON.stringify(justStarted));
    sendMock.mockResolvedValueOnce({ Body: { transformToString } });
    const { readActiveState, isInvestigationActive } = await import('../active-state');
    const snap = await readActiveState('c', 'a');
    expect(isInvestigationActive(snap)).toBe(true);
  });

  it('coerces unknown status to "unknown" without throwing', async () => {
    const odd = {
      investigationId: 'inv-x',
      status: 'no-such-state',
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    };
    transformToString.mockResolvedValueOnce(JSON.stringify(odd));
    sendMock.mockResolvedValueOnce({ Body: { transformToString } });
    const { readActiveState, isInvestigationActive } = await import('../active-state');
    const snap = await readActiveState('c', 'a');
    expect(snap?.status).toBe('unknown');
    expect(isInvestigationActive(snap)).toBe(false);
  });

  it('falls back to legacy lastHeartbeatAt epoch number for backward compat', async () => {
    // Older callers (pre-fix) wrote lastHeartbeatAt as epoch ms. parseState
    // should still accept that without forcing a re-deploy of every writer.
    const legacy = {
      investigationId: 'inv-legacy',
      status: 'running',
      startedAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 1000,
    };
    transformToString.mockResolvedValueOnce(JSON.stringify(legacy));
    sendMock.mockResolvedValueOnce({ Body: { transformToString } });
    const { readActiveState, isInvestigationActive } = await import('../active-state');
    const snap = await readActiveState('c', 'a');
    expect(isInvestigationActive(snap)).toBe(true);
  });
});
