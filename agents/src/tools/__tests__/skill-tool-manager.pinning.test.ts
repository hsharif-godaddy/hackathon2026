import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../workspace/index.js');

import { createForWorkspace } from '../../workspace/index.js';

const mockedCreateForWorkspace = vi.mocked(createForWorkspace);

function mockWorkspaceForPath(basePath: string): void {
  mockedCreateForWorkspace.mockImplementation(function () {
    const files = {
      view: async ({ path: filePath }: { path: string }) => {
        const full = join(basePath, filePath);
        const content = await fs.readFile(full, 'utf-8');
        return { content, encoding: 'utf-8' as const, path: filePath, lines: content.split('\n').length, size: content.length, truncated: false };
      },
      write: async ({ path: filePath, content }: { path: string; content: string }) => {
        const full = join(basePath, filePath);
        await fs.mkdir(join(full, '..'), { recursive: true });
        await fs.writeFile(full, content);
        return { bytesWritten: content.length };
      },
    };
    return { files, tasks: undefined } as ReturnType<typeof createForWorkspace>;
  });
}

function mockWorkspaceForPaths(paths: Map<string, string>): void {
  mockedCreateForWorkspace.mockImplementation(function (appId: string) {
    const basePath = paths.get(appId);
    if (!basePath) return null;
    const files = {
      view: async ({ path: filePath }: { path: string }) => {
        const full = join(basePath, filePath);
        const content = await fs.readFile(full, 'utf-8');
        return { content, encoding: 'utf-8' as const, path: filePath, lines: content.split('\n').length, size: content.length, truncated: false };
      },
      write: async ({ path: filePath, content }: { path: string; content: string }) => {
        const full = join(basePath, filePath);
        await fs.mkdir(join(full, '..'), { recursive: true });
        await fs.writeFile(full, content);
        return { bytesWritten: content.length };
      },
    };
    return { files, tasks: undefined } as ReturnType<typeof createForWorkspace>;
  });
}

import { SkillToolManager } from '../skill-tool-manager.js';

async function flushPersist(mgr: SkillToolManager): Promise<void> {
  const chain = (mgr as unknown as { persistChainByAppId: Map<string, Promise<void>> }).persistChainByAppId;
  await Promise.all(Array.from(chain.values()));
}

describe('SkillToolManager pinning', () => {
  let mgr: SkillToolManager;
  const conv = 'conv-1';

  beforeEach(() => {
    mgr = new SkillToolManager();
  });

  it('starts with no pinned skills for a conversation', () => {
    expect(mgr.getPinnedSkills(conv)).toEqual([]);
    expect(mgr.isPinned(conv, 'deep-build')).toBe(false);
  });

  it('pins a skill and reports it as pinned', () => {
    mgr.pinSkill(conv, 'deep-build');
    expect(mgr.getPinnedSkills(conv)).toEqual(['deep-build']);
    expect(mgr.isPinned(conv, 'deep-build')).toBe(true);
  });

  it('is idempotent on repeated pin calls', () => {
    mgr.pinSkill(conv, 'deep-build');
    mgr.pinSkill(conv, 'deep-build');
    expect(mgr.getPinnedSkills(conv)).toEqual(['deep-build']);
  });

  it('unpins a pinned skill', () => {
    mgr.pinSkill(conv, 'deep-build');
    mgr.unpinSkill(conv, 'deep-build');
    expect(mgr.isPinned(conv, 'deep-build')).toBe(false);
    expect(mgr.getPinnedSkills(conv)).toEqual([]);
  });

  it('unpinning a non-pinned skill is a no-op', () => {
    mgr.unpinSkill(conv, 'deep-build');
    expect(mgr.getPinnedSkills(conv)).toEqual([]);
  });

  it('isolates pinned state by conversation', () => {
    mgr.pinSkill('conv-A', 'deep-build');
    expect(mgr.isPinned('conv-B', 'deep-build')).toBe(false);
  });

  it('cleanupInactiveSkills never reports a pinned skill', () => {
    mgr.pinSkill(conv, 'deep-build');
    mgr.activateSkill(conv, 'deep-build', 0);
    const removed = mgr.cleanupInactiveSkills(conv, 10_000);
    expect(removed).not.toContain('deep-build');
  });

  it('cleanupInactiveSkills keeps pinned skills in active state (tools still visible)', () => {
    // Seed via the public registry path so skillTools is set; otherwise
    // getActiveToolNames would return [] regardless of activation state and
    // a regression that re-activates without re-seeding tools would silently
    // pass. We bypass registerSkill (which requires an initialized
    // toolRegistry) by setting the inner state directly through the same
    // primitives the registry uses.
    const conversationStateAccess = (mgr as unknown as {
      conversationState: {
        setSkillTools: (skill: string, tools: string[]) => void;
        activate: (cid: string, skill: string, step: number) => void;
      };
    }).conversationState;
    conversationStateAccess.setSkillTools('deep-build', ['plan']);
    mgr.pinSkill(conv, 'deep-build');
    conversationStateAccess.activate(conv, 'deep-build', 0);

    mgr.cleanupInactiveSkills(conv, 10_000);

    expect(mgr.getActiveSkills(conv)).toContain('deep-build');
    // Tool visibility — the actual contract prepareStep depends on.
    expect(mgr.getActiveToolNames(conv)).toContain('deep-build__plan');
  });

  it('unloadSkill refuses to unload a pinned skill', () => {
    mgr.pinSkill(conv, 'deep-build');
    const ok = mgr.unloadSkill('deep-build', conv);
    expect(ok).toBe(false);
    expect(mgr.isPinned(conv, 'deep-build')).toBe(true);
  });

  it('pinSkill rejects names containing path traversal', () => {
    const result = mgr.pinSkill(conv, '../etc/passwd');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid skill name/);
    expect(mgr.isPinned(conv, '../etc/passwd')).toBe(false);
  });

  it('pinSkill returns a successful result for a valid name', () => {
    const result = mgr.pinSkill(conv, 'deep-build');
    expect(result.success).toBe(true);
  });

  it('clearConversation removes pinned skills and active state', () => {
    mgr.pinSkill(conv, 'deep-build');
    mgr.activateSkill(conv, 'deep-build', 0);
    mgr.clearConversation(conv);
    expect(mgr.isPinned(conv, 'deep-build')).toBe(false);
    expect(mgr.getPinnedSkills(conv)).toEqual([]);
    expect(mgr.getActiveSkills(conv)).toEqual([]);
  });
});

describe('SkillToolManager persistence', () => {
  let mgr: SkillToolManager;
  let workDir: string;
  const APP_ID = 'test-persist-app';

  beforeEach(async () => {
    mgr = new SkillToolManager();
    workDir = await fs.mkdtemp(join(tmpdir(), 'pin-persist-'));
    mockWorkspaceForPath(workDir);
  });

  afterEach(async () => {
    mockedCreateForWorkspace.mockReset();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('writes .airo/pinned-skills.json on pin and reads it back on hydrate', async () => {
    mgr.pinSkill('conv-A', 'deep-build', APP_ID);
    await flushPersist(mgr);

    const file = join(workDir, '.airo', 'pinned-skills.json');
    const content = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(content).toEqual({ version: 1, conversations: { 'conv-A': ['deep-build'] } });

    // Fresh manager — hydrate should restore.
    const mgr2 = new SkillToolManager();
    await mgr2.hydrateFromWorkspace(APP_ID);
    expect(mgr2.isPinned('conv-A', 'deep-build')).toBe(true);
  });

  it('removes the entry from disk when the last skill is unpinned', async () => {
    mgr.pinSkill('conv-A', 'deep-build', APP_ID);
    await flushPersist(mgr);
    mgr.unpinSkill('conv-A', 'deep-build', APP_ID);
    await flushPersist(mgr);

    const file = join(workDir, '.airo', 'pinned-skills.json');
    const content = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(content).toEqual({ version: 1, conversations: {} });
  });

  it('hydrate is idempotent — second call does not re-read', async () => {
    mgr.pinSkill('conv-A', 'deep-build', APP_ID);
    await flushPersist(mgr);

    const mgr2 = new SkillToolManager();
    await mgr2.hydrateFromWorkspace(APP_ID);
    // Mutate file after first hydrate; second call must not pick the change up.
    await fs.writeFile(
      join(workDir, '.airo', 'pinned-skills.json'),
      JSON.stringify({ version: 1, conversations: { 'conv-B': ['seo'] } })
    );
    await mgr2.hydrateFromWorkspace(APP_ID);
    expect(mgr2.isPinned('conv-B', 'seo')).toBe(false);
  });

  it('concurrent hydrate calls share the same in-flight promise', async () => {
    mgr.pinSkill('conv-A', 'deep-build', APP_ID);
    await flushPersist(mgr);

    const mgr2 = new SkillToolManager();
    // Fire two concurrent hydrates. Without the in-flight cache, the
    // second would short-circuit before the first finished its read and
    // observe an empty pin set.
    const [p1, p2] = [mgr2.hydrateFromWorkspace(APP_ID), mgr2.hydrateFromWorkspace(APP_ID)];
    // Both must resolve to the same promise instance, not two separate reads.
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
    expect(mgr2.isPinned('conv-A', 'deep-build')).toBe(true);
  });

  it('rejects files without a version marker', async () => {
    await fs.mkdir(join(workDir, '.airo'), { recursive: true });
    await fs.writeFile(
      join(workDir, '.airo', 'pinned-skills.json'),
      JSON.stringify({ 'conv-A': ['deep-build'] }) // legacy unversioned shape
    );
    await mgr.hydrateFromWorkspace(APP_ID);
    expect(mgr.getPinnedSkills('conv-A')).toEqual([]);
  });

  it('rejects files with an unknown version', async () => {
    await fs.mkdir(join(workDir, '.airo'), { recursive: true });
    await fs.writeFile(
      join(workDir, '.airo', 'pinned-skills.json'),
      JSON.stringify({ version: 999, conversations: { 'conv-A': ['deep-build'] } })
    );
    await mgr.hydrateFromWorkspace(APP_ID);
    expect(mgr.getPinnedSkills('conv-A')).toEqual([]);
  });

  it('caps persisted conversations at 100 (drops oldest)', async () => {
    for (let i = 0; i < 105; i++) {
      mgr.pinSkill(`conv-${i.toString().padStart(3, '0')}`, 'deep-build', APP_ID);
    }
    await flushPersist(mgr);

    const file = join(workDir, '.airo', 'pinned-skills.json');
    const content = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(content.version).toBe(1);
    const keys = Object.keys(content.conversations);
    expect(keys).toHaveLength(100);
    // Oldest five (000..004) dropped; latest (005..104) retained.
    expect(keys).not.toContain('conv-000');
    expect(keys).toContain('conv-104');
  });

  it('skips invalid skill names in the file', async () => {
    await fs.mkdir(join(workDir, '.airo'), { recursive: true });
    await fs.writeFile(
      join(workDir, '.airo', 'pinned-skills.json'),
      JSON.stringify({
        version: 1,
        conversations: { 'conv-A': ['deep-build', '../etc/passwd', 12345] }
      })
    );
    await mgr.hydrateFromWorkspace(APP_ID);
    expect(mgr.getPinnedSkills('conv-A')).toEqual(['deep-build']);
  });

  it('missing file is not an error', async () => {
    await mgr.hydrateFromWorkspace(APP_ID);
    expect(mgr.getPinnedSkills('conv-A')).toEqual([]);
  });

  it('does not persist conversations that belong to a different appId', async () => {
    const otherDir = await fs.mkdtemp(join(tmpdir(), 'pin-persist-other-'));
    const OTHER_APP_ID = 'other-persist-app';
    const paths = new Map<string, string>([[APP_ID, workDir], [OTHER_APP_ID, otherDir]]);
    mockWorkspaceForPaths(paths);
    try {
      mgr.pinSkill('conv-A', 'deep-build', APP_ID);
      mgr.pinSkill('conv-B', 'seo', OTHER_APP_ID);
      await flushPersist(mgr);

      const fileA = JSON.parse(
        await fs.readFile(join(workDir, '.airo', 'pinned-skills.json'), 'utf8'),
      );
      const fileB = JSON.parse(
        await fs.readFile(join(otherDir, '.airo', 'pinned-skills.json'), 'utf8'),
      );
      expect(fileA).toEqual({ version: 1, conversations: { 'conv-A': ['deep-build'] } });
      expect(fileB).toEqual({ version: 1, conversations: { 'conv-B': ['seo'] } });
    } finally {
      await fs.rm(otherDir, { recursive: true, force: true });
    }
  });

  it('does not persist when appPath is not provided to pinSkill', async () => {
    mgr.pinSkill('conv-A', 'deep-build');
    await flushPersist(mgr);
    await expect(fs.access(join(workDir, '.airo', 'pinned-skills.json'))).rejects.toThrow();
  });

  it('clearConversation(appPath) removes a conversation the manager never observed', async () => {
    // Simulate prior process: pin A in this workspace, then restart.
    mgr.pinSkill('conv-A', 'deep-build', APP_ID);
    await flushPersist(mgr);

    // Fresh manager — the agent process never observed conv-A as a pin in
    // memory. Clearing should still remove it from the disk file because
    // the caller knows the appPath (e.g., DELETE /conversations route).
    const mgr2 = new SkillToolManager();
    await mgr2.hydrateFromWorkspace(APP_ID);
    mgr2.clearConversation('conv-A', APP_ID);
    await flushPersist(mgr2);

    const content = JSON.parse(
      await fs.readFile(join(workDir, '.airo', 'pinned-skills.json'), 'utf8'),
    );
    expect(content).toEqual({ version: 1, conversations: {} });
  });
});
