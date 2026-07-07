import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAllScenarios } from '../registry.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from './scenario-test-helpers.js';
import type { Scenario } from '../types.js';

const gocode = makeGocodeClient();
const ctrlPlane = makeCtrlPlaneClient();

function names(): string[] {
  return createAllScenarios(gocode, ctrlPlane).map(
    (s: Scenario): string => s.name,
  );
}

describe('registry marketing scenarios', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('always includes the two marketing-campaigns scenarios', () => {
    vi.stubEnv('ENABLE_SOCIAL', '');
    const n = names();
    expect(n).toContain('marketing-campaign-clarify-first');
    expect(n).toContain('marketing-campaign-no-channel-prompt');
    expect(n).not.toContain('marketing-campaign-vague-intent-customers');
    expect(n).not.toContain('marketing-campaign-vague-intent-grow');
  });

  it('omits social scenarios when ENABLE_SOCIAL is not "true"', () => {
    vi.stubEnv('ENABLE_SOCIAL', '');
    const n = names();
    expect(n).not.toContain('social-create-posts');
    expect(n).not.toContain('social-infer-not-interrogate');
  });

  it('includes social scenarios when ENABLE_SOCIAL=true', () => {
    vi.stubEnv('ENABLE_SOCIAL', 'true');
    const n = names();
    expect(n).toContain('social-create-posts');
    expect(n).toContain('social-infer-not-interrogate');
  });
});
