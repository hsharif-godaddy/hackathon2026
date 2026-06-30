import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    }),
  },
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { discoverPublishEnvContributors } from '../discover.js';

const tempDirs: string[] = [];

async function createSkillsDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'publish-env-skills-'));
  tempDirs.push(dir);
  return dir;
}

async function writeSkill(
  skillsDir: string,
  skillPath: string,
  skillMd: string,
  contributorSource: string
): Promise<void> {
  const skillDir = path.join(skillsDir, ...skillPath.split('/'));
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'skill.md'), skillMd);
  await writeFile(path.join(skillDir, 'publish-env-contributor.js'), contributorSource);
}

describe('discoverPublishEnvContributors', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('discovers publish env contributors owned by skill directories', async () => {
    const skillsDir = await createSkillsDir();
    await writeSkill(
      skillsDir,
      'commerce',
      ['---', 'name: commerce', '---', '', '# Commerce'].join('\n'),
      [
        'export const publishEnvContributor = {',
        "  name: 'commerce',",
        "  collect: async () => ({ vars: { GODADDY_STORE_ID: 'store-1' } }),",
        '};',
      ].join('\n')
    );

    const contributors = await discoverPublishEnvContributors({ skillsDir });

    expect(contributors).toHaveLength(1);
    expect(contributors[0]?.name).toBe('commerce');
    await expect(contributors[0]?.collect('abcde12345')).resolves.toEqual({
      vars: { GODADDY_STORE_ID: 'store-1' },
    });
  });

  it('does not import contributors for skills disabled by enablementId', async () => {
    const skillsDir = await createSkillsDir();
    await writeSkill(
      skillsDir,
      'disabled-skill',
      ['---', 'name: disabled-skill', 'enablementId: disabledPublishEnvSkill', '---', '', '# Disabled'].join('\n'),
      "throw new Error('disabled contributor should not load');"
    );

    await expect(discoverPublishEnvContributors({ skillsDir })).resolves.toEqual([]);
  });

  it('associates nested contributor modules with the nearest skill.md', async () => {
    const skillsDir = await createSkillsDir();
    await mkdir(path.join(skillsDir, 'payment'), { recursive: true });
    await writeFile(
      path.join(skillsDir, 'payment', 'skill.md'),
      ['---', 'name: payment', '---', '', '# Payment'].join('\n')
    );
    await writeSkill(
      skillsDir,
      'payment/stripe',
      ['---', 'name: payment/stripe', '---', '', '# Stripe'].join('\n'),
      [
        'export default {',
        "  name: 'payment/stripe',",
        "  collect: async () => ({ vars: { STRIPE_MODE: 'live' } }),",
        '};',
      ].join('\n')
    );

    const contributors = await discoverPublishEnvContributors({ skillsDir });

    expect(contributors.map((contributor) => contributor.name)).toEqual(['payment/stripe']);
  });
});
