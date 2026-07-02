import { describe, it, expect, beforeEach } from 'vitest';

import { AppliedSkillsRegistry, writeSkillState } from '../applied-skills-registry.js';
import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
import type { CreateForWorkspace, WorkspaceClient } from '../../workspace/client.js';
import type { ReadTextOptions, ViewOptions, ViewResult, WriteOptions, WriteResult } from '../../workspace/files.js';

/**
 * Map-backed in-memory workspace stand-in. `view` throws a REAL
 * DevSupervisorError('not_found', 404) when the path is absent (matching the
 * supervisor's 404 contract); `write` stores the content. This exercises the
 * exact not-found-swallow path the registry relies on.
 */
class InMemoryWorkspace {
  readonly files: Map<string, string> = new Map();
  /** Records every (path, content) write in order, for payload/serialization assertions. */
  readonly writes: Array<{ path: string; content: string }> = [];
  /** Optional gate to control when a pending write resolves (serialization test). */
  private writeGate: ((path: string) => Promise<void>) | null = null;

  setWriteGate(gate: (path: string) => Promise<void>): void {
    this.writeGate = gate;
  }

  view = async (options: ViewOptions): Promise<ViewResult> => {
    const content: string | undefined = this.files.get(options.path);
    if (content === undefined) {
      throw new DevSupervisorError('not_found', 404, `${options.path}: no such file`);
    }
    return {
      path: options.path,
      content,
      encoding: 'utf-8',
      lines: content.split('\n').length,
      size: content.length,
      truncated: false,
    };
  };

  readText = async (options: ReadTextOptions): Promise<string> => {
    const content: string | undefined = this.files.get(options.path);
    if (content === undefined) {
      throw new DevSupervisorError('not_found', 404, `${options.path}: no such file`);
    }
    return content;
  };

  write = async (options: WriteOptions): Promise<WriteResult> => {
    if (this.writeGate) await this.writeGate(options.path);
    this.files.set(options.path, options.content);
    this.writes.push({ path: options.path, content: options.content });
    return { bytesWritten: options.content.length };
  };
}

const APPLIED_SKILLS_PATH = '.airo/applied-skills.json';
const statePath = (skill: string): string => `.airo/skills/${skill}/state.json`;

function makeFactory(workspace: InMemoryWorkspace | null): CreateForWorkspace {
  return (): WorkspaceClient | null => {
    if (!workspace) return null;
    return { files: workspace } as unknown as WorkspaceClient;
  };
}

/** Drain the registry's per-app persist chain so on-disk assertions are stable. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('applied-skills-registry', () => {
  const appId = 'app1234567';
  let workspace: InMemoryWorkspace;
  let registry: AppliedSkillsRegistry;

  beforeEach(() => {
    workspace = new InMemoryWorkspace();
    registry = new AppliedSkillsRegistry(makeFactory(workspace));
  });

  describe('#recordInstall', () => {
    it('records an installedAt timestamp on first call', () => {
      registry.recordInstall('stripe-v2', appId);
      const skills = registry.getInstalledSkills(appId);
      expect(skills.has('stripe-v2')).toBe(true);
      expect(typeof skills.get('stripe-v2')?.installedAt).toBe('string');
    });

    it('is idempotent — second call does not overwrite installedAt', () => {
      registry.recordInstall('stripe-v2', appId);
      const firstTimestamp = registry.getInstalledSkills(appId).get('stripe-v2')?.installedAt;

      registry.recordInstall('stripe-v2', appId);
      const secondTimestamp = registry.getInstalledSkills(appId).get('stripe-v2')?.installedAt;

      expect(firstTimestamp).toBe(secondTimestamp);
    });

    it('tracks multiple skills independently', () => {
      registry.recordInstall('stripe-v2', appId);
      registry.recordInstall('conversations', appId);
      const skills = registry.getInstalledSkills(appId);
      expect(skills.size).toBe(2);
      expect(skills.has('stripe-v2')).toBe(true);
      expect(skills.has('conversations')).toBe(true);
    });

    it('persists applied-skills.json to the workspace with the expected payload and path', async () => {
      registry.recordInstall('stripe-v2', appId);
      await flush();

      const raw = workspace.files.get(APPLIED_SKILLS_PATH);
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw as string);
      expect(parsed.version).toBe(1);
      expect(parsed.skills['stripe-v2'].installedAt).toBeDefined();
      expect(workspace.writes.some((w) => w.path === APPLIED_SKILLS_PATH)).toBe(true);
    });
  });

  describe('#recordComplete', () => {
    it('records a completedAt timestamp on first call', () => {
      registry.recordComplete('authentication', appId);
      const skills = registry.getInstalledSkills(appId);
      expect(skills.has('authentication')).toBe(true);
      expect(typeof skills.get('authentication')?.completedAt).toBe('string');
    });

    it('is idempotent — second call does not overwrite completedAt', () => {
      registry.recordComplete('authentication', appId);
      const firstTimestamp = registry.getInstalledSkills(appId).get('authentication')?.completedAt;

      registry.recordComplete('authentication', appId);
      const secondTimestamp = registry.getInstalledSkills(appId).get('authentication')?.completedAt;

      expect(firstTimestamp).toBe(secondTimestamp);
    });

    it('does not overwrite an existing installedAt when recording complete', () => {
      registry.recordInstall('authentication', appId);
      const installedAt = registry.getInstalledSkills(appId).get('authentication')?.installedAt;

      registry.recordComplete('authentication', appId);

      expect(registry.getInstalledSkills(appId).get('authentication')?.installedAt).toBe(installedAt);
      expect(registry.getInstalledSkills(appId).get('authentication')?.completedAt).toBeDefined();
    });

    it('can record install and complete on the same skill', () => {
      registry.recordInstall('authentication', appId);
      registry.recordComplete('authentication', appId);
      const entry = registry.getInstalledSkills(appId).get('authentication');
      expect(entry?.installedAt).toBeDefined();
      expect(entry?.completedAt).toBeDefined();
    });
  });

  describe('#getInstalledSkills', () => {
    it('returns an empty map for an app with nothing recorded', () => {
      const skills = registry.getInstalledSkills('app-unknown1');
      expect(skills.size).toBe(0);
    });
  });

  describe('#hydrateFromAppId', () => {
    it('silently treats a missing applied-skills.json as no persisted state', async () => {
      await registry.hydrateFromAppId(appId);
      expect(registry.getInstalledSkills(appId).size).toBe(0);
    });

    it('reads the registry file and populates installed skills', async () => {
      workspace.files.set(
        APPLIED_SKILLS_PATH,
        JSON.stringify({
          version: 1,
          skills: {
            'stripe-v2': { installedAt: '2024-01-01T00:00:00.000Z' },
            conversations: { installedAt: '2024-01-02T00:00:00.000Z' },
          },
        })
      );

      await registry.hydrateFromAppId(appId);

      const skills = registry.getInstalledSkills(appId);
      expect(skills.size).toBe(2);
      expect(skills.get('stripe-v2')?.installedAt).toBe('2024-01-01T00:00:00.000Z');
      expect(skills.get('conversations')?.installedAt).toBe('2024-01-02T00:00:00.000Z');
    });

    it('reads completedAt from the registry file', async () => {
      workspace.files.set(
        APPLIED_SKILLS_PATH,
        JSON.stringify({
          version: 1,
          skills: {
            'authentication': {
              installedAt: '2024-01-01T00:00:00.000Z',
              completedAt: '2024-01-02T00:00:00.000Z',
            },
          },
        })
      );

      await registry.hydrateFromAppId(appId);

      const entry = registry.getInstalledSkills(appId).get('authentication');
      expect(entry?.installedAt).toBe('2024-01-01T00:00:00.000Z');
      expect(entry?.completedAt).toBe('2024-01-02T00:00:00.000Z');
    });

    it('ignores files with unknown version numbers', async () => {
      workspace.files.set(
        APPLIED_SKILLS_PATH,
        JSON.stringify({ version: 99, skills: { auth: { installedAt: '2024-01-01T00:00:00.000Z' } } })
      );

      await registry.hydrateFromAppId(appId);

      expect(registry.getInstalledSkills(appId).size).toBe(0);
    });

    it('is idempotent — calling twice does not double-load', async () => {
      workspace.files.set(
        APPLIED_SKILLS_PATH,
        JSON.stringify({ version: 1, skills: { 'stripe-v2': { installedAt: '2024-01-01T00:00:00.000Z' } } })
      );

      await registry.hydrateFromAppId(appId);
      registry.recordInstall('conversations', appId);
      await registry.hydrateFromAppId(appId);

      expect(registry.getInstalledSkills(appId).has('conversations')).toBe(true);
    });

    it('propagates a non-not-found transport error path by returning no state and not throwing', async () => {
      registry = new AppliedSkillsRegistry(
        makeFactory({
          ...new InMemoryWorkspace(),
          view: async () => {
            throw new DevSupervisorError('permission_denied', 403, 'denied');
          },
          readText: async () => {
            throw new DevSupervisorError('permission_denied', 403, 'denied');
          },
          write: async (o: WriteOptions): Promise<WriteResult> => ({ bytesWritten: o.content.length }),
        } as unknown as InMemoryWorkspace)
      );

      await expect(registry.hydrateFromAppId(appId)).resolves.toBeUndefined();
      expect(registry.getInstalledSkills(appId).size).toBe(0);
    });
  });

  describe('#readSkillState', () => {
    it('returns null when no state file exists (not-found)', async () => {
      const state = await registry.readSkillState('stripe-v2', appId);
      expect(state).toBeNull();
    });

    it('returns the parsed JSON written by writeSkillState (round-trip)', async () => {
      await writeSkillState('stripe-v2', appId, { provisioned: true, sandboxId: 'cbsbx_test' }, makeFactory(workspace));
      const state = await registry.readSkillState('stripe-v2', appId);
      expect(state).toEqual({ provisioned: true, sandboxId: 'cbsbx_test' });
    });

    it('returns null for a corrupted state file', async () => {
      workspace.files.set(statePath('stripe-v2'), 'not valid json');
      const state = await registry.readSkillState('stripe-v2', appId);
      expect(state).toBeNull();
    });
  });

  describe('#mergeSkillState', () => {
    it('writes the patch when no prior state exists', async () => {
      await registry.mergeSkillState('compliance-docs', appId, { privacyPolicy: { generated: true } });
      const state = await registry.readSkillState('compliance-docs', appId);
      expect(state).toEqual({ privacyPolicy: { generated: true } });
    });

    it('writes to the correct per-skill state path', async () => {
      await registry.mergeSkillState('compliance-docs', appId, { privacyPolicy: { generated: true } });
      expect(workspace.files.has(statePath('compliance-docs'))).toBe(true);
    });

    it('shallow-merges patch over existing state without dropping prior keys', async () => {
      await writeSkillState('compliance-docs', appId, { privacyPolicy: { generated: true } }, makeFactory(workspace));
      await registry.mergeSkillState('compliance-docs', appId, { termsOfUse: { generated: true } });
      const state = await registry.readSkillState('compliance-docs', appId);
      expect(state).toEqual({
        privacyPolicy: { generated: true },
        termsOfUse: { generated: true },
      });
    });

    it('serializes concurrent calls for the same (app, skill) — neither patch is lost and writes do not interleave', async () => {
      // Gate each write behind a microtask so two concurrent merges would
      // interleave their read-modify-write if not serialized. The per-key
      // promise chain must force them to run strictly one after the other.
      let inWrite = false;
      let overlapDetected = false;
      workspace.setWriteGate(async () => {
        if (inWrite) overlapDetected = true;
        inWrite = true;
        await Promise.resolve();
        inWrite = false;
      });

      await Promise.all([
        registry.mergeSkillState('compliance-docs', appId, { privacyPolicy: { generated: true, businessName: 'Acme' } }),
        registry.mergeSkillState('compliance-docs', appId, { termsOfUse: { generated: true, jurisdiction: 'Texas' } }),
      ]);

      expect(overlapDetected).toBe(false);
      const state = await registry.readSkillState('compliance-docs', appId);
      expect(state).toHaveProperty('privacyPolicy');
      expect(state).toHaveProperty('termsOfUse');
      expect((state as Record<string, Record<string, unknown>>).privacyPolicy.businessName).toBe('Acme');
      expect((state as Record<string, Record<string, unknown>>).termsOfUse.jurisdiction).toBe('Texas');
    });

    it('serializes calls for different skills independently', async () => {
      await Promise.all([
        registry.mergeSkillState('stripe-v2', appId, { provisioned: true }),
        registry.mergeSkillState('conversations', appId, { accountId: 'acc-123' }),
      ]);

      expect(await registry.readSkillState('stripe-v2', appId)).toEqual({ provisioned: true });
      expect(await registry.readSkillState('conversations', appId)).toEqual({ accountId: 'acc-123' });
    });

    it('auto-registers a skill in applied-skills.json when state is written without an explicit install', async () => {
      await registry.mergeSkillState('online-conferencing', appId, { providers: ['zoom'] });

      const skills = registry.getInstalledSkills(appId);
      expect(skills.has('online-conferencing')).toBe(true);
      expect(skills.get('online-conferencing')?.installedAt).toBeDefined();
    });

    it('preserves the existing installedAt when state is written for an already-registered skill', async () => {
      registry.recordInstall('stripe-v2', appId);
      const before = registry.getInstalledSkills(appId).get('stripe-v2')?.installedAt;

      await registry.mergeSkillState('stripe-v2', appId, { provisioned: true });

      const after = registry.getInstalledSkills(appId).get('stripe-v2')?.installedAt;
      expect(after).toBe(before);
    });

    it('returns the merged state snapshot', async () => {
      await writeSkillState('compliance-docs', appId, { privacyPolicy: { generated: true } }, makeFactory(workspace));
      const snapshot = await registry.mergeSkillState('compliance-docs', appId, { termsOfUse: { generated: true } });
      expect(snapshot).toEqual({
        privacyPolicy: { generated: true },
        termsOfUse: { generated: true },
      });
    });

    it('still returns the in-memory merged state even when workspace write fails silently', async () => {
      // writeSkillState catches errors internally, so applyStatePatch still returns
      // the merged object regardless of whether the file was persisted.
      const unavailable = new AppliedSkillsRegistry(makeFactory(null));
      const snapshot = await unavailable.mergeSkillState('compliance-docs', appId, { x: 1 });
      expect(snapshot).toEqual({ x: 1 });
    });

    it('persists the auto-registered skill to applied-skills.json in the workspace', async () => {
      await registry.mergeSkillState('online-conferencing', appId, { providers: ['google'] });
      await flush();

      const raw = workspace.files.get(APPLIED_SKILLS_PATH);
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw as string);
      expect(parsed.skills['online-conferencing']).toBeDefined();
      expect(parsed.skills['online-conferencing'].installedAt).toBeDefined();
    });
  });

  describe('workspace unavailable', () => {
    it('rejects writeSkillState path by swallowing — write_failed is non-fatal', async () => {
      // writeSkillState swallows resolution failures (non-fatal persistence).
      await expect(
        writeSkillState('stripe-v2', appId, { provisioned: true }, makeFactory(null))
      ).resolves.toBeUndefined();
    });

    it('readSkillState returns null when the workspace cannot be bound', async () => {
      const unavailable = new AppliedSkillsRegistry(makeFactory(null));
      await expect(unavailable.readSkillState('stripe-v2', appId)).resolves.toBeNull();
    });

    it('hydrateFromAppId resolves without throwing when the workspace cannot be bound', async () => {
      const unavailable = new AppliedSkillsRegistry(makeFactory(null));
      await expect(unavailable.hydrateFromAppId(appId)).resolves.toBeUndefined();
      expect(unavailable.getInstalledSkills(appId).size).toBe(0);
    });
  });
});

describe('writeSkillState', () => {
  const appId = 'writeapp123';
  let workspace: InMemoryWorkspace;

  beforeEach(() => {
    workspace = new InMemoryWorkspace();
  });

  it('writes the state file at the correct workspace-relative path', async () => {
    await writeSkillState('conversations', appId, { accountId: 'brand.url', color: '#1e40af' }, makeFactory(workspace));
    const raw = workspace.files.get(statePath('conversations'));
    expect(JSON.parse(raw as string)).toEqual({ accountId: 'brand.url', color: '#1e40af' });
  });

  it('overwrites the previous state file on a second write', async () => {
    await writeSkillState('stripe-v2', appId, { claimStatus: 'provisioned' }, makeFactory(workspace));
    await writeSkillState('stripe-v2', appId, { claimStatus: 'claimed', liveAccountId: 'acct_live' }, makeFactory(workspace));
    const raw = workspace.files.get(statePath('stripe-v2'));
    expect(JSON.parse(raw as string)).toEqual({ claimStatus: 'claimed', liveAccountId: 'acct_live' });
  });
});
