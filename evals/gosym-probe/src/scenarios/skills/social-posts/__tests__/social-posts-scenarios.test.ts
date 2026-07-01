import { describe, it, expect } from 'vitest';
import {
  socialCreatePostsScenario,
  socialInferNotInterrogateScenario,
} from '../index.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../../__tests__/scenario-test-helpers.js';
import {
  MARKETING_AGENT_DISPLAY_NAME,
  MARKETING_HANDOFF,
} from '../../../types.js';

const gocode = makeGocodeClient();
const ctrlPlane = makeCtrlPlaneClient();

describe('social-posts scenarios', () => {
  it('social-create-posts targets the marketing agent + the social-posts skill', () => {
    const s = socialCreatePostsScenario(gocode, ctrlPlane);
    expect(s.name).toBe('social-create-posts');
    expect(s.suite).toBe('social-posts');
    expect(s.expectedAgent).toBe(MARKETING_AGENT_DISPLAY_NAME);
    expect(s.expectedSkills).toContain('social-posts');
    expect(s.trials).toBe(3);
    expect(s.expectedTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'skill', called: true }),
        expect.objectContaining({ tool: 'socialPostCreate', called: true }),
        MARKETING_HANDOFF,
      ]),
    );
  });

  it('social-infer-not-interrogate asserts post creation + the marketing handoff', () => {
    const s = socialInferNotInterrogateScenario(gocode, ctrlPlane);
    expect(s.name).toBe('social-infer-not-interrogate');
    expect(s.staticFirstMessage).toBe(
      'Create some Facebook posts for my coffee shop',
    );
    expect(s.expectedTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'socialPostCreate', called: true }),
        MARKETING_HANDOFF,
      ]),
    );
  });

  it('social-create-posts requires no-premature-publish', () => {
    const s = socialCreatePostsScenario(gocode, ctrlPlane);
    const ids = (s.skillInstructions ?? []).map((i) => i.id);
    expect(ids).toContain('no-premature-publish');
  });

  it('social-infer requires no-premature-publish and minimal-questions', () => {
    const s = socialInferNotInterrogateScenario(gocode, ctrlPlane);
    const ids = (s.skillInstructions ?? []).map((i) => i.id);
    expect(ids).toContain('no-premature-publish');
    expect(ids).toContain('minimal-questions');
  });
});
