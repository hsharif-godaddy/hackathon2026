import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHookService } from '../../services/git-hook-service.js';

/**
 * Test the in-flight operation tracking used by shutdown to await
 * disconnect-triggered git operations.
 */
describe('GitHookService in-flight operation tracking', () => {
  let service: GitHookService;

  beforeEach(() => {
    service = new GitHookService();
    vi.restoreAllMocks();
  });

  it('waitForInFlightOps resolves immediately when no ops are tracked', async () => {
    await service.waitForInFlightOps();
    // No error = success
  });

  it('waitForInFlightOps waits for tracked operations to complete', async () => {
    let resolveOp!: () => void;
    const op = new Promise<void>(resolve => { resolveOp = resolve; });

    service.trackOperation(op);

    let waited = false;
    const waitPromise = service.waitForInFlightOps().then(() => { waited = true; });

    // Should not have resolved yet
    await Promise.resolve(); // flush microtasks
    expect(waited).toBe(false);

    // Complete the operation
    resolveOp();
    await waitPromise;
    expect(waited).toBe(true);
  });

  it('waitForInFlightOps handles rejected operations gracefully', async () => {
    let rejectOp!: (err: Error) => void;
    const op = new Promise<void>((_, reject) => { rejectOp = reject; });

    service.trackOperation(op);
    rejectOp(new Error('git lock failed'));

    // Should not throw — uses Promise.allSettled internally
    await service.waitForInFlightOps();
  });

  it('completed operations are removed from tracking', async () => {
    const op = Promise.resolve();
    service.trackOperation(op);

    // Wait for the .finally() cleanup to run
    await new Promise(resolve => setTimeout(resolve, 0));

    // Now waitForInFlightOps should resolve immediately (no ops left)
    await service.waitForInFlightOps();
  });

  it('tracks multiple concurrent operations', async () => {
    let resolveOp1!: () => void;
    let resolveOp2!: () => void;
    const op1 = new Promise<void>(resolve => { resolveOp1 = resolve; });
    const op2 = new Promise<void>(resolve => { resolveOp2 = resolve; });

    service.trackOperation(op1);
    service.trackOperation(op2);

    let waited = false;
    const waitPromise = service.waitForInFlightOps().then(() => { waited = true; });

    resolveOp1();
    await Promise.resolve();
    expect(waited).toBe(false); // op2 still pending

    resolveOp2();
    await waitPromise;
    expect(waited).toBe(true);
  });
});
