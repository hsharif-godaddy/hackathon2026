import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PublishJobRegistry, ConflictError } from '../job-registry.js';

describe('PublishJobRegistry', () => {
  let registry: PublishJobRegistry;

  beforeEach(() => {
    registry = new PublishJobRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create', () => {
    it('creates a job with building phase', () => {
      const job = registry.create('app-1');

      expect(job.appId).toBe('app-1');
      expect(job.phase).toBe('building');
      expect(job.jobId).toMatch(/^pub_/);
      expect(job.commitHash).toBeNull();
      expect(job.version).toBeNull();
      expect(job.error).toBeNull();
      expect(job.logs).toBeNull();
      expect(job.startedAt).toBe(Date.now());
    });

    it('throws ConflictError when job already active', () => {
      registry.create('app-1');

      expect(() => registry.create('app-1')).toThrow(ConflictError);
    });

    it('allows create after stale terminal job auto-clears', () => {
      registry.create('app-1');
      registry.update('app-1', { phase: 'deployed', commitHash: 'abc' });
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      const job = registry.create('app-1');
      expect(job.phase).toBe('building');
    });

    it('blocks create for in-progress job even after TTL', () => {
      registry.create('app-1');
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      expect(() => registry.create('app-1')).toThrow(ConflictError);
    });

    it('allows create after terminal deployed job', () => {
      registry.create('app-1');
      registry.update('app-1', { phase: 'deployed', commitHash: 'abc' });

      const job = registry.create('app-1');
      expect(job.phase).toBe('building');
    });

    it('allows create after terminal failed job', () => {
      registry.create('app-1');
      registry.update('app-1', { phase: 'failed', error: 'boom' });

      const job = registry.create('app-1');
      expect(job.phase).toBe('building');
    });
  });

  describe('get', () => {
    it('returns job when active', () => {
      registry.create('app-1');
      const job = registry.get('app-1');

      expect(job).not.toBeNull();
      expect(job!.appId).toBe('app-1');
    });

    it('returns null for unknown app', () => {
      expect(registry.get('unknown')).toBeNull();
    });

    it('returns null and clears stale terminal job', () => {
      registry.create('app-1');
      registry.update('app-1', { phase: 'failed', error: 'timeout' });
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      expect(registry.get('app-1')).toBeNull();
    });

    it('returns in-progress job even after TTL', () => {
      registry.create('app-1');
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      const job = registry.get('app-1');
      expect(job).not.toBeNull();
      expect(job!.phase).toBe('building');
    });

    it('evicts stuck in-progress job after max lifetime (12min)', () => {
      registry.create('app-1');
      vi.advanceTimersByTime(12 * 60 * 1000 + 1);

      expect(registry.get('app-1')).toBeNull();
    });

    it('evicts stuck deploying job after max lifetime', () => {
      registry.create('app-1');
      registry.update('app-1', { phase: 'deploying', commitHash: 'abc' });
      vi.advanceTimersByTime(12 * 60 * 1000 + 1);

      expect(registry.get('app-1')).toBeNull();
    });

    it('allows re-publish after stuck job is evicted by max lifetime', () => {
      registry.create('app-1');
      vi.advanceTimersByTime(12 * 60 * 1000 + 1);

      const job = registry.create('app-1');
      expect(job.phase).toBe('building');
    });
  });

  describe('update', () => {
    it('transitions phase from building to deploying', () => {
      registry.create('app-1');
      const updated = registry.update('app-1', { phase: 'deploying', commitHash: 'abc123' });

      expect(updated!.phase).toBe('deploying');
      expect(updated!.commitHash).toBe('abc123');
    });

    it('stores error and logs on failure', () => {
      registry.create('app-1');
      const updated = registry.update('app-1', {
        phase: 'failed',
        error: 'Build timed out',
        logs: ['line 1', 'line 2'],
        buildTimeoutSeconds: 300,
      });

      expect(updated!.phase).toBe('failed');
      expect(updated!.error).toBe('Build timed out');
      expect(updated!.logs).toEqual(['line 1', 'line 2']);
      expect(updated!.buildTimeoutSeconds).toBe(300);
    });

    it('returns null for unknown app', () => {
      expect(registry.update('unknown', { phase: 'deployed' })).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes the job', () => {
      registry.create('app-1');
      registry.clear('app-1');

      expect(registry.get('app-1')).toBeNull();
    });

    it('no-ops for unknown app', () => {
      expect(() => registry.clear('unknown')).not.toThrow();
    });
  });
});
