import { describe, it, expect, vi } from 'vitest';
import { createStatefulApp } from '../create-stateful-app.js';
import type { AABCtrlPlaneClient } from '../../../clients/aab-ctrl-plane-client.js';

type CtrlPlaneStub = Pick<
  AABCtrlPlaneClient,
  'provisionApp' | 'resetApp' | 'deleteApp'
>;

function makeCtrlPlane(): CtrlPlaneStub & {
  provisionApp: ReturnType<typeof vi.fn>;
  resetApp: ReturnType<typeof vi.fn>;
  deleteApp: ReturnType<typeof vi.fn>;
} {
  let n = 0;
  return {
    provisionApp: vi.fn().mockImplementation(async () => {
      n += 1;
      return { appId: `app-${n}`, previewUrl: `https://preview/${n}` };
    }),
    resetApp: vi.fn().mockResolvedValue(undefined),
    deleteApp: vi.fn().mockResolvedValue(undefined),
  };
}

describe('createStatefulApp — provision once', () => {
  it('provisions a single app across many trial setups', async () => {
    const cp = makeCtrlPlane();
    const { setup } = createStatefulApp(cp);

    const a = await setup();
    const b = await setup();
    const c = await setup();

    expect(cp.provisionApp).toHaveBeenCalledOnce();
    expect(a.appId).toBe('app-1');
    expect(b.appId).toBe('app-1');
    expect(c.appId).toBe('app-1');
  });

  it('re-attempts provisioning after a failure instead of poisoning the memo', async () => {
    const cp = makeCtrlPlane();
    cp.provisionApp
      .mockRejectedValueOnce(new Error('transient provision failure'))
      .mockResolvedValueOnce({ appId: 'app-recovered', previewUrl: 'https://preview/r' });
    const { setup } = createStatefulApp(cp);

    await expect(setup()).rejects.toThrow('transient provision failure');
    // A later trial gets a fresh attempt rather than the cached rejection.
    const ok = await setup();
    expect(ok.appId).toBe('app-recovered');
    expect(cp.provisionApp).toHaveBeenCalledTimes(2);
  });

  it('shares one provision across concurrent setups (no race double-provision)', async () => {
    const cp = makeCtrlPlane();
    const { setup } = createStatefulApp(cp);

    const [a, b, c] = await Promise.all([setup(), setup(), setup()]);

    expect(cp.provisionApp).toHaveBeenCalledOnce();
    expect(a.appId).toBe('app-1');
    expect(b.appId).toBe('app-1');
    expect(c.appId).toBe('app-1');
  });
});

describe('createStatefulApp — reset between trials', () => {
  it('does not reset on the first trial, resets on every subsequent trial', async () => {
    const cp = makeCtrlPlane();
    const { setup } = createStatefulApp(cp);

    await setup(); // trial 1 — establishes baseline, no reset
    expect(cp.resetApp).not.toHaveBeenCalled();

    await setup(); // trial 2
    await setup(); // trial 3
    expect(cp.resetApp).toHaveBeenCalledTimes(2);
    expect(cp.resetApp).toHaveBeenLastCalledWith('app-1', {});
  });

  it('forwards a resetCommit when configured', async () => {
    const cp = makeCtrlPlane();
    const { setup } = createStatefulApp(cp, { resetCommit: 'abc123' });

    await setup();
    await setup();

    expect(cp.resetApp).toHaveBeenCalledWith('app-1', { commit: 'abc123' });
  });

  it('never resets when resetBetweenTrials is false', async () => {
    const cp = makeCtrlPlane();
    const { setup } = createStatefulApp(cp, { resetBetweenTrials: false });

    await setup();
    await setup();
    await setup();

    expect(cp.resetApp).not.toHaveBeenCalled();
  });
});

describe('createStatefulApp — seeded conversation summary', () => {
  const seededSummary = { summaryText: '## State\nLanding page built.' };

  it('seeds after each reset, on every trial, for a borrowed existing app', async () => {
    const cp = makeCtrlPlane();
    const existingApp = { appId: 'prebuilt-1', previewUrl: 'https://preview/prebuilt' };
    const seedSummary = vi.fn().mockResolvedValue('summary-id');
    const { setup } = createStatefulApp(
      cp,
      { existingApp, resetCommit: 'base-sha', seededSummary },
      seedSummary,
    );

    await setup();
    await setup();

    expect(seedSummary).toHaveBeenCalledTimes(2);
    expect(seedSummary).toHaveBeenCalledWith('prebuilt-1', seededSummary);
  });

  it('seeds only on resetting trials for a provisioned app (not the baseline trial)', async () => {
    const cp = makeCtrlPlane();
    const seedSummary = vi.fn().mockResolvedValue('summary-id');
    const { setup } = createStatefulApp(cp, { seededSummary }, seedSummary);

    await setup(); // trial 1 — establishes baseline, no reset → no seed
    expect(seedSummary).not.toHaveBeenCalled();

    await setup(); // trial 2 — resets → seeds
    await setup(); // trial 3 — resets → seeds
    expect(seedSummary).toHaveBeenCalledTimes(2);
    expect(seedSummary).toHaveBeenCalledWith('app-1', seededSummary);
  });

  it('seeds AFTER the reset, never before (file base then conversation state)', async () => {
    const cp = makeCtrlPlane();
    const existingApp = { appId: 'prebuilt-1', previewUrl: 'https://preview/prebuilt' };
    const order: string[] = [];
    cp.resetApp.mockImplementation(async () => { order.push('reset'); });
    const seedSummary = vi.fn().mockImplementation(async () => { order.push('seed'); });
    const { setup } = createStatefulApp(cp, { existingApp, seededSummary }, seedSummary);

    await setup();

    expect(order).toEqual(['reset', 'seed']);
  });

  it('does not seed when no summary is configured', async () => {
    const cp = makeCtrlPlane();
    const existingApp = { appId: 'prebuilt-1', previewUrl: 'https://preview/prebuilt' };
    const seedSummary = vi.fn().mockResolvedValue('summary-id');
    const { setup } = createStatefulApp(cp, { existingApp }, seedSummary);

    await setup();

    expect(seedSummary).not.toHaveBeenCalled();
  });

  it('throws at construction if a summary is set but no seeder is provided', () => {
    const cp = makeCtrlPlane();
    expect(() => createStatefulApp(cp, { seededSummary })).toThrow(
      /seededSummary was set but no seedSummary callback/i,
    );
  });
});

describe('createStatefulApp — teardown', () => {
  it('per-trial teardown does not delete the shared app', async () => {
    const cp = makeCtrlPlane();
    const { setup, teardown } = createStatefulApp(cp);

    const ctx = await setup();
    await teardown(ctx);
    await teardown(ctx);

    expect(cp.deleteApp).not.toHaveBeenCalled();
  });

  it('teardownShared deletes the shared app exactly once', async () => {
    const cp = makeCtrlPlane();
    const { setup, teardownShared } = createStatefulApp(cp);

    await setup();
    await setup();
    await teardownShared();

    expect(cp.deleteApp).toHaveBeenCalledOnce();
    expect(cp.deleteApp).toHaveBeenCalledWith('app-1');
  });

  it('teardownShared is a no-op when nothing was ever provisioned', async () => {
    const cp = makeCtrlPlane();
    const { teardownShared } = createStatefulApp(cp);

    await teardownShared();

    expect(cp.deleteApp).not.toHaveBeenCalled();
  });
});

describe('createStatefulApp — existingApp (fixed pre-built base)', () => {
  const existingApp = { appId: 'prebuilt-1', previewUrl: 'https://preview/prebuilt' };

  it('never provisions; reuses the supplied app for every trial', async () => {
    const cp = makeCtrlPlane();
    const { setup } = createStatefulApp(cp, { existingApp, resetCommit: 'base-sha' });

    const a = await setup();
    const b = await setup();

    expect(cp.provisionApp).not.toHaveBeenCalled();
    expect(a.appId).toBe('prebuilt-1');
    expect(b.appId).toBe('prebuilt-1');
  });

  it('resets to the pinned base on EVERY trial, including the first', async () => {
    const cp = makeCtrlPlane();
    const { setup } = createStatefulApp(cp, { existingApp, resetCommit: 'base-sha' });

    await setup(); // trial 0 — borrowed app must start from the pinned base too
    await setup(); // trial 1
    await setup(); // trial 2

    expect(cp.resetApp).toHaveBeenCalledTimes(3);
    expect(cp.resetApp).toHaveBeenCalledWith('prebuilt-1', { commit: 'base-sha' });
  });

  it('resets to HEAD (no commit key) when resetCommit is omitted', async () => {
    const cp = makeCtrlPlane();
    const { setup } = createStatefulApp(cp, { existingApp });
    await setup();
    expect(cp.resetApp).toHaveBeenCalledWith('prebuilt-1', {});
  });

  it('skips reset when resetBetweenTrials is false (documented degenerate case)', async () => {
    const cp = makeCtrlPlane();
    const { setup } = createStatefulApp(cp, { existingApp, resetBetweenTrials: false });
    await setup();
    await setup();
    expect(cp.resetApp).not.toHaveBeenCalled();
  });

  it('teardownShared does NOT delete a borrowed app', async () => {
    const cp = makeCtrlPlane();
    const { setup, teardownShared } = createStatefulApp(cp, { existingApp });

    await setup();
    await teardownShared();

    expect(cp.deleteApp).not.toHaveBeenCalled();
  });
});
