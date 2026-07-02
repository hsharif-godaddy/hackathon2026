/**
 * AppliedSkillsRegistry - Tracks which skills have been installed and their current state.
 *
 * Solves "skill amnesia": when conversation history is summarized by
 * LLMSummarizationStrategy, evidence of what was built gets compressed or lost.
 *
 * Data is app-scoped, not conversation-scoped — the relevant question is
 * "what is installed in this app?", not "what did we do in conversation X?".
 *
 * ─── Layer 1: Installed skills ────────────────────────────────────────────────
 *   Records which skills have had their templates scaffolded into the app.
 *   Stored in: <workspace>/.airo/applied-skills.json
 *
 * ─── Layer 2: Current state (mutable, skill-owned) ───────────────────────────
 *   Skills write their own state file reflecting CURRENT configuration.
 *   Answers: "what does this skill's implementation look like right now?"
 *   Handles modification scenarios (e.g., Google OAuth replaced with GitHub):
 *   the skill tool overwrites its state.json when configuration changes, so the
 *   LLM always sees the current setup, not a historical log of past actions.
 *   Stored in: <workspace>/.airo/skills/<skillName>/state.json
 *   Written by: individual skill tools via writeSkillState()
 *
 * What is NOT recorded: tool invocation history. Audit logs of which tools were
 * called are misleading after configuration changes — e.g. switching from GitHub
 * to Google OAuth would leave stale GitHub entries in the log. The current state
 * written by writeSkillState() is the authoritative source of truth.
 *
 * Persistence boundary: all file I/O goes through the Workspace File API
 * (`createForWorkspace(appId, 'preview').files`) rather than `node:fs`. Paths are
 * workspace-relative POSIX. The write endpoint creates parent directories and
 * writes atomically (tmp + same-dir rename) server-side, so no client-side
 * mkdir or temp-file dance is needed — a single `write()` is atomic.
 */

import { logger } from '../logging/index.js';
import { createForWorkspace } from '../workspace/index.js';
import { WorkspaceUnavailableError } from '../workspace/errors.js';
import { isDevSupervisorNotFound } from '../services/DevSupervisorClient.js';
import type { CreateForWorkspace } from '../workspace/client.js';
import type { WorkspaceFiles } from '../workspace/files.js';

const REGISTRY_FILE_VERSION = 1;
const APPLIED_SKILLS_PATH = '.airo/applied-skills.json';

export interface AppliedSkillEntry {
  /** ISO timestamp of the first `skill install` call for this skill in this app. */
  installedAt?: string;
  /** ISO timestamp of the first `skill complete` call for this skill in this app. */
  completedAt?: string;
}

interface AppliedSkillsFile {
  version: 1;
  skills: Record<string, AppliedSkillEntry>;
}

function skillStatePath(skillName: string): string {
  return `.airo/skills/${skillName}/state.json`;
}

/**
 * Resolve the preview workspace's file API for an app, or throw
 * WorkspaceUnavailableError when no bindable supervisor exists.
 */
function resolveWorkspaceFiles(appId: string, workspaceFactory: CreateForWorkspace): WorkspaceFiles {
  const workspace = workspaceFactory(appId, 'preview');
  if (!workspace) {
    throw new WorkspaceUnavailableError(appId, 'preview');
  }
  return workspace.files;
}

export class AppliedSkillsRegistry {
  private readonly workspaceFactory: CreateForWorkspace;

  /** appId → Map<skillName, entry> */
  private byAppId = new Map<string, Map<string, AppliedSkillEntry>>();
  private hydrationPromises = new Map<string, Promise<void>>();
  private persistChainByAppId = new Map<string, Promise<void>>();
  /**
   * Serializes concurrent mergeSkillState calls per (appId, skillName).
   * Key: `${appId}::${skillName}`
   */
  private stateWriteChain = new Map<string, Promise<Record<string, unknown> | undefined>>();

  constructor(workspaceFactory: CreateForWorkspace = createForWorkspace) {
    this.workspaceFactory = workspaceFactory;
  }

  /**
   * Record that a skill's templates were installed into the app.
   * Idempotent: the installedAt timestamp is set only on the first call.
   */
  recordInstall(skillName: string, appId: string): void {
    const skills = this.getOrCreate(appId);
    const existing: AppliedSkillEntry = skills.get(skillName) ?? {};
    skills.set(skillName, {
      ...existing,
      installedAt: existing.installedAt ?? new Date().toISOString(),
    });
    this.schedulePersist(appId);
    logger.info('applied_skills.install.recorded', { skillName, appId });
  }

  /**
   * Record that a skill's full workflow has been completed in the app.
   * Idempotent: the completedAt timestamp is set only on the first call.
   */
  recordComplete(skillName: string, appId: string): void {
    const skills: Map<string, AppliedSkillEntry> = this.getOrCreate(appId);
    const existing: AppliedSkillEntry = skills.get(skillName) ?? {};
    skills.set(skillName, {
      ...existing,
      completedAt: existing.completedAt ?? new Date().toISOString(),
    });
    this.schedulePersist(appId);
    logger.info('applied_skills.complete.recorded', { skillName, appId });
  }

  /** Return all installed skill entries for an app. */
  getInstalledSkills(appId: string): Map<string, AppliedSkillEntry> {
    return this.byAppId.get(appId) ?? new Map();
  }

  /**
   * Read a skill's current-state file (Layer 2).
   *
   * Returns the raw JSON object written by the skill's own tools, or null if
   * the skill has not written any state. The schema is skill-defined — the
   * registry treats it as an opaque value and passes it through to the LLM.
   *
   * Path: <workspace>/.airo/skills/<skillName>/state.json
   */
  async readSkillState(skillName: string, appId: string): Promise<Record<string, unknown> | null> {
    const path: string = skillStatePath(skillName);
    try {
      const files: WorkspaceFiles = resolveWorkspaceFiles(appId, this.workspaceFactory);
      const result = await files.view({ path });
      const parsed: unknown = JSON.parse(result.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch (error) {
      // A missing state file is the "no persisted state" case — return null.
      if (isDevSupervisorNotFound(error)) return null;
      // An unbound preview supervisor is an expected-transient state (e.g. just
      // after app creation), not a real error — log at debug so it does not add
      // per-turn warn noise; still treated as "no persisted state".
      if (error instanceof WorkspaceUnavailableError) {
        logger.debug('applied_skills.state.workspace_unavailable', { skillName, appId });
        return null;
      }
      logger.warn('applied_skills.state.read_failed', {
        skillName,
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Atomically merge a state patch into a skill's state file.
   *
   * Concurrent calls for the same (appId, skillName) are serialized via a
   * per-key promise chain — the same pattern used by schedulePersist for
   * applied-skills.json. This prevents a lost-update race where two tools of
   * the same skill fire concurrently: both read the same existing state, then
   * the second write clobbers the first tool's keys.
   *
   * Each tool only needs to return the fields it owns in computeState; this
   * method guarantees those fields are shallow-merged without dropping keys
   * written by other tools of the same skill.
   */
  mergeSkillState(skillName: string, appId: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const key: string = `${appId}::${skillName}`;
    const prev: Promise<Record<string, unknown> | undefined> = this.stateWriteChain.get(key) ?? Promise.resolve(undefined);
    const next: Promise<Record<string, unknown> | undefined> = prev.then(() => this.applyStatePatch(skillName, appId, patch)).catch(() => undefined);
    this.stateWriteChain.set(key, next);
    return next;
  }

  private async applyStatePatch(
    skillName: string,
    appId: string,
    patch: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Guarantee a registry entry exists so the skill surfaces in the applied-skills
    // context message even if it was never explicitly installed via `skill install`.
    // Guidance-only skills (e.g. online-conferencing) define computeState tools but
    // never copy templates, so applied-skills.json would otherwise have no entry for
    // them and their state would be written to disk but never injected into the LLM.
    if (!this.getOrCreate(appId).has(skillName)) {
      this.recordInstall(skillName, appId);
    }
    const existing: Record<string, unknown> = await this.readSkillState(skillName, appId) ?? {};
    const merged: Record<string, unknown> = { ...existing, ...patch };
    await writeSkillState(skillName, appId, merged, this.workspaceFactory);
    return merged;
  }

  /**
   * Read the per-workspace registry file into the in-memory map.
   *
   * Called before every context build so the map always reflects the latest
   * on-disk state. Unlike pinned-skills context (static per conversation),
   * applied-skills.json is mutable — skills are installed and state is written
   * while the process is running, so we must re-read on every turn.
   *
   * Concurrent callers for the same appId share a single in-flight read to
   * avoid redundant disk I/O within a single context-loading cycle.
   * Missing or unreadable files are silently ignored.
   */
  hydrateFromAppId(appId: string): Promise<void> {
    const inFlight: Promise<void> | undefined = this.hydrationPromises.get(appId);
    if (inFlight) return inFlight;
    const started: Promise<void> = this.hydrateInner(appId).finally(() => {
      this.hydrationPromises.delete(appId);
    });
    this.hydrationPromises.set(appId, started);
    return started;
  }

  private async hydrateInner(appId: string): Promise<void> {
    let raw: string;
    try {
      const files: WorkspaceFiles = resolveWorkspaceFiles(appId, this.workspaceFactory);
      const result = await files.view({ path: APPLIED_SKILLS_PATH });
      raw = result.content;
    } catch (error) {
      if (isDevSupervisorNotFound(error)) return;
      // An unbound preview supervisor is an expected-transient state (e.g. just
      // after app creation), not a real error — log at debug so it does not add
      // per-turn warn noise on every context build.
      if (error instanceof WorkspaceUnavailableError) {
        logger.debug('applied_skills.hydrate.workspace_unavailable', { appId });
        return;
      }
      logger.warn('applied_skills.hydrate.read_failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn('applied_skills.hydrate.parse_failed', { appId });
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    const obj: Record<string, unknown> = parsed as Record<string, unknown>;
    const map: Map<string, AppliedSkillEntry> = this.getOrCreate(appId);

    if (obj.version !== REGISTRY_FILE_VERSION) {
      logger.warn('applied_skills.hydrate.unknown_version', {
        appId,
        fileVersion: obj.version,
        supportedVersion: REGISTRY_FILE_VERSION,
      });
      return;
    }

    const skills: unknown = obj.skills;
    if (!skills || typeof skills !== 'object') return;
    for (const [skillName, entry] of Object.entries(skills as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const e: Record<string, unknown> = entry as Record<string, unknown>;
      map.set(skillName, {
        ...(typeof e.installedAt === 'string' && { installedAt: e.installedAt }),
        ...(typeof e.completedAt === 'string' && { completedAt: e.completedAt }),
      });
    }
    logger.info('applied_skills.hydrated', { appId, skillCount: map.size });
  }

  private getOrCreate(appId: string): Map<string, AppliedSkillEntry> {
    let map: Map<string, AppliedSkillEntry> | undefined = this.byAppId.get(appId);
    if (!map) {
      map = new Map();
      this.byAppId.set(appId, map);
    }
    return map;
  }

  private schedulePersist(appId: string): void {
    const prev: Promise<void> = this.persistChainByAppId.get(appId) ?? Promise.resolve();
    const next: Promise<void> = prev.then(() => this.persist(appId)).catch(() => {});
    this.persistChainByAppId.set(appId, next);
  }

  private async persist(appId: string): Promise<void> {
    const skillsMap: Map<string, AppliedSkillEntry> | undefined = this.byAppId.get(appId);
    if (!skillsMap || skillsMap.size === 0) return;

    const payload: AppliedSkillsFile = {
      version: REGISTRY_FILE_VERSION,
      skills: Object.fromEntries(skillsMap),
    };

    try {
      const files: WorkspaceFiles = resolveWorkspaceFiles(appId, this.workspaceFactory);
      // The write endpoint creates parent dirs and writes atomically server-side.
      await files.write({
        path: APPLIED_SKILLS_PATH,
        content: JSON.stringify(payload, null, 2),
      });
    } catch (error) {
      logger.warn('applied_skills.persist_failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const appliedSkillsRegistry = new AppliedSkillsRegistry();

/**
 * Write a skill's current state to its own state file.
 *
 * Skills call this from their tool handlers whenever their configuration changes.
 * The state object is skill-defined and completely replaces any previous state —
 * this is intentional, as it ensures the LLM always sees current configuration,
 * not a historical accumulation of past states.
 *
 * Path: <workspace>/.airo/skills/<skillName>/state.json
 *
 * Usage in a skill tool:
 *   await writeSkillState('auth', appId, { provider: 'google', sessionStrategy: 'jwt' });
 */
export async function writeSkillState(
  skillName: string,
  appId: string,
  state: Record<string, unknown>,
  workspaceFactory: CreateForWorkspace = createForWorkspace
): Promise<void> {
  const path: string = skillStatePath(skillName);
  try {
    const files: WorkspaceFiles = resolveWorkspaceFiles(appId, workspaceFactory);
    // The write endpoint creates parent dirs and writes atomically server-side.
    await files.write({ path, content: JSON.stringify(state, null, 2) });
    logger.info('applied_skills.state.written', { skillName, appId });
  } catch (error) {
    logger.warn('applied_skills.state.write_failed', {
      skillName,
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
