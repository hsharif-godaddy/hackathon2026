import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DevSupervisorClient } from '../../../services/DevSupervisorClient.js';
import { HttpDeployments } from '../http-deployments.js';
import { WorkspaceNotImplementedError, VariantNotApplicableError } from '../../errors.js';

function makeClient() {
  return {
    publish: vi.fn(),
    unpublish: vi.fn(),
    getPublishStatus: vi.fn(),
  } as unknown as DevSupervisorClient;
}

describe('HttpDeployments', () => {
  let client: DevSupervisorClient;

  beforeEach(() => {
    client = makeClient();
  });

  describe('publish variant', () => {
    let deployments: HttpDeployments;
    beforeEach(() => {
      deployments = new HttpDeployments(client, 'publish');
    });

    it('activate throws WorkspaceNotImplementedError', async () => {
      await expect(deployments.activate({ artifactId: 'abc' })).rejects.toBeInstanceOf(
        WorkspaceNotImplementedError,
      );
    });

    it('unpublish forwards to client.unpublish', async () => {
      (client.unpublish as any).mockResolvedValue({ status: 'success' });
      const result = await deployments.unpublish();
      expect(result.status).toBe('success');
    });

    it('status maps getPublishStatus response', async () => {
      (client.getPublishStatus as any).mockResolvedValue({
        version: 'v1',
        health: { status: 'healthy', message: 'ok' },
        process: { state: 'running', pid: 10, uptime: '5m' },
        warnings: [],
      });
      const result = await deployments.status({ includeLogs: false });
      expect(client.getPublishStatus).toHaveBeenCalledWith({
        includeLogs: false,
        lines: undefined,
      });
      expect(result.version).toBe('v1');
      expect(result.process.state).toBe('running');
      expect(result.process.pid).toBe(10);
    });

    it('status hydrates log timestamps and drops Go zero-values', async () => {
      (client.getPublishStatus as any).mockResolvedValue({
        version: 'v1',
        health: { status: 'healthy', message: 'ok' },
        process: { state: 'running', pid: 10, uptime: '5m' },
        logs: [
          { timestamp: '2026-05-08T10:00:00Z', source: 'stdout', message: 'ready' },
          { timestamp: '0001-01-01T00:00:00Z', source: 'stderr', message: 'zero' },
        ],
        warnings: [],
      });
      const result = await deployments.status({ includeLogs: true });
      expect(result.logs?.[0].timestamp).toEqual(new Date('2026-05-08T10:00:00Z'));
      // Go zero-value is normalised to epoch (LogEntry.timestamp is non-optional).
      expect(result.logs?.[1].timestamp).toEqual(new Date(0));
    });

    it('status hydrates startedAt from wire uptime', async () => {
      vi.useFakeTimers({ now: 1_700_000_000_000 });
      try {
        (client.getPublishStatus as any).mockResolvedValue({
          version: 'v1',
          health: { status: 'healthy', message: 'ok' },
          process: { state: 'running', pid: 10, uptime: '120s' },
          warnings: [],
        });
        const result = await deployments.status();
        expect(result.process.startedAt).toBeInstanceOf(Date);
        expect(result.process.startedAt!.getTime()).toBe(1_700_000_000_000 - 120_000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('prepare throws VariantNotApplicableError (preview-only)', async () => {
      await expect(deployments.prepare()).rejects.toBeInstanceOf(VariantNotApplicableError);
    });
  });

  describe('preview variant', () => {
    let deployments: HttpDeployments;
    beforeEach(() => {
      deployments = new HttpDeployments(client, 'preview');
    });

    it('activate throws VariantNotApplicableError', async () => {
      await expect(deployments.activate({ artifactId: 'x' })).rejects.toBeInstanceOf(
        VariantNotApplicableError,
      );
    });

    it('unpublish throws VariantNotApplicableError', async () => {
      await expect(deployments.unpublish()).rejects.toBeInstanceOf(VariantNotApplicableError);
    });

    it('status throws VariantNotApplicableError', async () => {
      await expect(deployments.status()).rejects.toBeInstanceOf(VariantNotApplicableError);
    });

    it('prepare throws WorkspaceNotImplementedError', async () => {
      await expect(deployments.prepare()).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
    });
  });
});
