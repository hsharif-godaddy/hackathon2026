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
  DEVELOP_AGENT_DISPLAY_NAME,
  NO_MARKETING_HANDOFF,
} from '../../../types.js';

const gocode = makeGocodeClient();
const ctrlPlane = makeCtrlPlaneClient();

describe('social-posts scenarios', () => {
  it('social-create-posts stays on develop + loads the social-posts skill', () => {
    const s = socialCreatePostsScenario(gocode, ctrlPlane);
    expect(s.name).toBe('social-create-posts');
    expect(s.suite).toBe('social-posts');
    expect(s.expectedAgent).toBe(DEVELOP_AGENT_DISPLAY_NAME);
    expect(s.expectedSkills).toContain('social-posts');
    expect(s.trials).toBe(5);
    expect(s.expectedTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'skill', called: true }),
        expect.objectContaining({ tool: 'socialPostCreate', called: true }),
        NO_MARKETING_HANDOFF,
      ]),
    );
  });

  it('social-infer-not-interrogate asserts post creation + NO marketing handoff', () => {
    const s = socialInferNotInterrogateScenario(gocode, ctrlPlane);
    expect(s.name).toBe('social-infer-not-interrogate');
    expect(s.staticFirstMessage).toBe(
      'Create some Facebook posts for my coffee shop',
    );
    expect(s.expectedTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'socialPostCreate', called: true }),
        NO_MARKETING_HANDOFF,
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
