import { describe, it, expect, beforeEach } from 'vitest';
import { skillToolManager } from '../../tools/skill-tool-manager.js';
import { buildPinnedSkillsContextMessages } from '../pinned-skills-context.js';

describe('buildPinnedSkillsContextMessages', () => {
  const conv = 'conv-ctx-1';

  beforeEach(() => {
    for (const s of skillToolManager.getPinnedSkills(conv)) {
      skillToolManager.unpinSkill(conv, s);
    }
  });

  it('returns [] when no skills are pinned', async () => {
    const msgs = await buildPinnedSkillsContextMessages(conv);
    expect(msgs).toEqual([]);
  });

  it('silently drops pinned skills that cannot be loaded', async () => {
    skillToolManager.pinSkill(conv, 'this-skill-does-not-exist');
    const msgs = await buildPinnedSkillsContextMessages(conv);
    expect(msgs).toEqual([]);
  });

  it('returns one message per existing pinned skill with its instructions embedded', async () => {
    // Pin an existing skill — pick one that is guaranteed to exist in the repo.
    // 'seo' is a known-good skill in agents/src/skills/seo/skill.md.
    skillToolManager.pinSkill(conv, 'seo');
    const msgs = await buildPinnedSkillsContextMessages(conv);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toMatch(/SEO/i);
    // The wrapper labels the content as a pinned skill
    expect(msgs[0].content).toMatch(/Pinned skill: seo/);
  });
});
