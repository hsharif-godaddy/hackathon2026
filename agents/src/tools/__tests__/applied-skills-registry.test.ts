import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { AppliedSkillsRegistry, writeSkillState } from '../applied-skills-registry.js';

describe('applied-skills-registry', () => {
  let appPath: string;
  let registry: AppliedSkillsRegistry;

  beforeEach(async function setup() {
    appPath = join(tmpdir(), `airo-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(appPath, '.airo'), { recursive: true });
    registry = new AppliedSkillsRegistry();
  });

  afterEach(async function cleanup() {
    try {
      await rm(appPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('#recordInstall', () => {
    it('records an installedAt timestamp on first call', function record() {
      registry.recordInstall('stripe-v2', appPath);
      const skills = registry.getInstalledSkills(appPath);
      expect(skills.has('stripe-v2')).toBe(true);
      expect(typeof skills.get('stripe-v2')?.installedAt).toBe('string');
    });

    it('is idempotent — second call does not overwrite installedAt', function idempotent() {
      registry.recordInstall('stripe-v2', appPath);
      const firstTimestamp = registry.getInstalledSkills(appPath).get('stripe-v2')?.installedAt;

      registry.recordInstall('stripe-v2', appPath);
      const secondTimestamp = registry.getInstalledSkills(appPath).get('stripe-v2')?.installedAt;

      expect(firstTimestamp).toBe(secondTimestamp);
    });

    it('tracks multiple skills independently', function multiple() {
      registry.recordInstall('stripe-v2', appPath);
      registry.recordInstall('conversations', appPath);
      const skills = registry.getInstalledSkills(appPath);
      expect(skills.size).toBe(2);
      expect(skills.has('stripe-v2')).toBe(true);
      expect(skills.has('conversations')).toBe(true);
    });
  });

  describe('#getInstalledSkills', () => {
    it('returns an empty map for an app with nothing recorded', function empty() {
      const skills = registry.getInstalledSkills('/some/unknown/path');
      expect(skills.size).toBe(0);
    });
  });

  describe('#hydrateFromAppPath', () => {
    it('silently ignores a missing applied-skills.json', async function missingFile() {
      await registry.hydrateFromAppPath(appPath);
      expect(registry.getInstalledSkills(appPath).size).toBe(0);
    });

    it('reads the registry file and populates installed skills', async function readFile() {
      const payload = {
        version: 1,
        skills: {
          'stripe-v2': { installedAt: '2024-01-01T00:00:00.000Z' },
          'conversations': { installedAt: '2024-01-02T00:00:00.000Z' },
        },
      };
      await writeFile(join(appPath, '.airo', 'applied-skills.json'), JSON.stringify(payload));

      await registry.hydrateFromAppPath(appPath);

      const skills = registry.getInstalledSkills(appPath);
      expect(skills.size).toBe(2);
      expect(skills.get('stripe-v2')?.installedAt).toBe('2024-01-01T00:00:00.000Z');
      expect(skills.get('conversations')?.installedAt).toBe('2024-01-02T00:00:00.000Z');
    });

    it('ignores files with unknown version numbers', async function unknownVersion() {
      const payload = { version: 99, skills: { 'auth': { installedAt: '2024-01-01T00:00:00.000Z' } } };
      await writeFile(join(appPath, '.airo', 'applied-skills.json'), JSON.stringify(payload));

      await registry.hydrateFromAppPath(appPath);

      expect(registry.getInstalledSkills(appPath).size).toBe(0);
    });

    it('is idempotent — calling twice does not double-load', async function doubleLoad() {
      const payload = {
        version: 1,
        skills: { 'stripe-v2': { installedAt: '2024-01-01T00:00:00.000Z' } },
      };
      await writeFile(join(appPath, '.airo', 'applied-skills.json'), JSON.stringify(payload));

      await registry.hydrateFromAppPath(appPath);
      registry.recordInstall('conversations', appPath);
      // Second call should not re-read the file and overwrite in-memory state
      await registry.hydrateFromAppPath(appPath);

      expect(registry.getInstalledSkills(appPath).has('conversations')).toBe(true);
    });
  });

  describe('#mergeSkillState', () => {
    it('writes the patch when no prior state exists', async function fresh() {
      await registry.mergeSkillState('compliance-docs', appPath, { privacyPolicy: { generated: true } });
      const state = await registry.readSkillState('compliance-docs', appPath);
      expect(state).toEqual({ privacyPolicy: { generated: true } });
    });

    it('shallow-merges patch over existing state without dropping prior keys', async function merge() {
      await writeSkillState('compliance-docs', appPath, { privacyPolicy: { generated: true } });
      await registry.mergeSkillState('compliance-docs', appPath, { termsOfUse: { generated: true } });
      const state = await registry.readSkillState('compliance-docs', appPath);
      expect(state).toEqual({
        privacyPolicy: { generated: true },
        termsOfUse: { generated: true },
      });
    });

    it('serializes concurrent calls — neither patch is lost', async function concurrent() {
      // Simulate two tools of the same skill firing concurrently.
      // Without serialization the second write clobbers the first.
      await Promise.all([
        registry.mergeSkillState('compliance-docs', appPath, { privacyPolicy: { generated: true, businessName: 'Acme' } }),
        registry.mergeSkillState('compliance-docs', appPath, { termsOfUse: { generated: true, jurisdiction: 'Texas' } }),
      ]);

      const state = await registry.readSkillState('compliance-docs', appPath);
      expect(state).toHaveProperty('privacyPolicy');
      expect(state).toHaveProperty('termsOfUse');
      expect((state as any).privacyPolicy.businessName).toBe('Acme');
      expect((state as any).termsOfUse.jurisdiction).toBe('Texas');
    });

    it('serializes calls for different skills independently', async function independent() {
      await Promise.all([
        registry.mergeSkillState('stripe-v2', appPath, { provisioned: true }),
        registry.mergeSkillState('conversations', appPath, { accountId: 'acc-123' }),
      ]);

      expect(await registry.readSkillState('stripe-v2', appPath)).toEqual({ provisioned: true });
      expect(await registry.readSkillState('conversations', appPath)).toEqual({ accountId: 'acc-123' });
    });

    it('auto-registers a skill in applied-skills.json when state is written without an explicit install', async function autoRegister() {
      // Simulate a guidance-only skill (e.g. online-conferencing) that defines
      // computeState tools but never calls skill({ action: 'install' }).
      await registry.mergeSkillState('online-conferencing', appPath, { providers: ['zoom'] });

      const skills = registry.getInstalledSkills(appPath);
      expect(skills.has('online-conferencing')).toBe(true);
      expect(skills.get('online-conferencing')?.installedAt).toBeDefined();
    });

    it('preserves the existing installedAt when state is written for an already-registered skill', async function preserveTimestamp() {
      registry.recordInstall('stripe-v2', appPath);
      const before = registry.getInstalledSkills(appPath).get('stripe-v2')?.installedAt;

      await registry.mergeSkillState('stripe-v2', appPath, { provisioned: true });

      const after = registry.getInstalledSkills(appPath).get('stripe-v2')?.installedAt;
      expect(after).toBe(before);
    });

    it('persists the auto-registered skill to applied-skills.json on disk', async function diskPersist() {
      await registry.mergeSkillState('online-conferencing', appPath, { providers: ['google'] });

      const raw = await readFile(join(appPath, '.airo', 'applied-skills.json'), 'utf8');
      const file = JSON.parse(raw);
      expect(file.skills['online-conferencing']).toBeDefined();
      expect(file.skills['online-conferencing'].installedAt).toBeDefined();
    });
  });

  describe('#readSkillState', () => {
    it('returns null for a non-existent state file', async function missing() {
      const state = await registry.readSkillState('stripe-v2', appPath);
      expect(state).toBeNull();
    });

    it('returns the parsed JSON written by writeSkillState', async function roundtrip() {
      await writeSkillState('stripe-v2', appPath, { provisioned: true, sandboxId: 'cbsbx_test' });
      const state = await registry.readSkillState('stripe-v2', appPath);
      expect(state).toEqual({ provisioned: true, sandboxId: 'cbsbx_test' });
    });

    it('returns null for a corrupted state file', async function corrupt() {
      const dir = join(appPath, '.airo', 'skills', 'stripe-v2');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'state.json'), 'not valid json');
      const state = await registry.readSkillState('stripe-v2', appPath);
      expect(state).toBeNull();
    });
  });
});

describe('writeSkillState', () => {
  let appPath: string;

  beforeEach(async function setup() {
    appPath = join(tmpdir(), `airo-write-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(appPath, { recursive: true });
  });

  afterEach(async function cleanup() {
    try {
      await rm(appPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('creates the state file at the correct path', async function path() {
    await writeSkillState('conversations', appPath, { accountId: 'brand.url', color: '#1e40af' });
    const raw = await readFile(join(appPath, '.airo', 'skills', 'conversations', 'state.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ accountId: 'brand.url', color: '#1e40af' });
  });

  it('creates parent directories automatically', async function dirs() {
    // Start from a fresh appPath with no .airo dir
    await writeSkillState('commerce', appPath, { storeId: 'store-123', channelId: 'ch-456' });
    const raw = await readFile(join(appPath, '.airo', 'skills', 'commerce', 'state.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ storeId: 'store-123', channelId: 'ch-456' });
  });

  it('overwrites the previous state file on a second write', async function overwrite() {
    await writeSkillState('stripe-v2', appPath, { claimStatus: 'provisioned' });
    await writeSkillState('stripe-v2', appPath, { claimStatus: 'claimed', liveAccountId: 'acct_live' });
    const raw = await readFile(join(appPath, '.airo', 'skills', 'stripe-v2', 'state.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ claimStatus: 'claimed', liveAccountId: 'acct_live' });
  });
});
