import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  makeCtrlPlaneClient,
  makeGocodeClient,
} from '../../__tests__/scenario-test-helpers.js';
import { rebuildFromUrlScenario, rebuildSourceUrl } from '../rebuild-from-url.js';

describe('rebuild-from-url scenario', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('has correct name and suite', () => {
    const scenario = rebuildFromUrlScenario(makeGocodeClient(), makeCtrlPlaneClient());
    expect(scenario.name).toBe('rebuild-from-url');
    expect(scenario.suite).toBe('rebuild');
  });

  it('uses a rebuild source URL in the static first message', () => {
    const scenario = rebuildFromUrlScenario(makeGocodeClient(), makeCtrlPlaneClient());
    expect(scenario.staticFirstMessage).toContain('Rebuild my website from');
    expect(scenario.staticFirstMessage).toContain('Harbor Cafe');
  });

  it('uses PROBE_REBUILD_SOURCE_URL when set', () => {
    vi.stubEnv('PROBE_REBUILD_SOURCE_URL', '  https://cafe.example.com  ');
    expect(rebuildSourceUrl()).toBe('https://cafe.example.com');
    const scenario = rebuildFromUrlScenario(makeGocodeClient(), makeCtrlPlaneClient());
    expect(scenario.staticFirstMessage).toContain('https://cafe.example.com');
  });

  it('falls back when PROBE_REBUILD_SOURCE_URL is whitespace-only', () => {
    vi.stubEnv('PROBE_REBUILD_SOURCE_URL', '   ');
    expect(rebuildSourceUrl()).toBe('https://example.com');
  });

  it('includes rebuild execution health evaluator', () => {
    const scenario = rebuildFromUrlScenario(makeGocodeClient(), makeCtrlPlaneClient());
    const names = scenario.evaluators.map((evaluator) => evaluator.name);
    expect(names).toContain('rebuild-execution-health');
    expect(names).toContain('tool-call-verification');
  });

  it('expects websiteRebuild to be called', () => {
    const scenario = rebuildFromUrlScenario(makeGocodeClient(), makeCtrlPlaneClient());
    expect(scenario.expectedTools).toEqual([
      expect.objectContaining({
        called: true,
        toolPattern: expect.any(RegExp),
      }),
    ]);
  });

  it('has setup and teardown', () => {
    const scenario = rebuildFromUrlScenario(makeGocodeClient(), makeCtrlPlaneClient());
    expect(scenario.setup).toBeInstanceOf(Function);
    expect(scenario.teardown).toBeInstanceOf(Function);
  });
});
