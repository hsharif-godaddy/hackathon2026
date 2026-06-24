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
 *   Stored in: <appPath>/.airo/applied-skills.json
 *
 * ─── Layer 2: Current state (mutable, skill-owned) ───────────────────────────
 *   Skills write their own state file reflecting CURRENT configuration.
 *   Answers: "what does this skill's implementation look like right now?"
 *   Handles modification scenarios (e.g., Google OAuth replaced with GitHub):
 *   the skill tool overwrites its state.json when configuration changes, so the
 *   LLM always sees the current setup, not a historical log of past actions.
 *   Stored in: <appPath>/.airo/skills/<skillName>/state.json
 *   Written by: individual skill tools via writeSkillState()
 *
 * What is NOT recorded: tool invocation history. Audit logs of which tools were
 * called are misleading after configuration changes — e.g. switching from GitHub
 * to Google OAuth would leave stale GitHub entries in the log. The current state
 * written by writeSkillState() is the authoritative source of truth.
 */

import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { logger } from '../logging/index.js';

const REGISTRY_FILE_VERSION = 1;

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

export class AppliedSkillsRegistry {
  /** appPath → Map<skillName, entry> */
  private byAppPath = new Map<string, Map<string, AppliedSkillEntry>>();
  private hydrationPromises = new Map<string, Promise<void>>();
  private persistChainByAppPath = new Map<string, Promise<void>>();
  /**
   * Serializes concurrent mergeSkillState calls per (appPath, skillName).
   * Key: `${appPath}::${skillName}`
   */
  private stateWriteChain = new Map<string, Promise<Record<string, unknown> | undefined>>();

  /**
   * Record that a skill's templates were installed into the app.
   * Idempotent: the installedAt timestamp is set only on the first call.
   */
  recordInstall(skillName: string, appPath: string): void {
    const skills = this.getOrCreate(appPath);
    const existing = skills.get(skillName) ?? {};
    skills.set(skillName, {
      ...existing,
      installedAt: existing.installedAt ?? new Date().toISOString(),
    });
    this.schedulePersist(appPath);
    logger.info('applied_skills.install.recorded', { skillName, appPath });
  }

  /**
   * Record that a skill's full workflow has been completed in the app.
   * Idempotent: the completedAt timestamp is set only on the first call.
   */
  recordComplete(skillName: string, appPath: string): void {
    const skills = this.getOrCreate(appPath);
    const existing = skills.get(skillName) ?? {};
    skills.set(skillName, {
      ...existing,
      completedAt: existing.completedAt ?? new Date().toISOString(),
    });
    this.schedulePersist(appPath);
    logger.info('applied_skills.complete.recorded', { skillName, appPath });
  }

  /** Return all installed skill entries for an app. */
  getInstalledSkills(appPath: string): Map<string, AppliedSkillEntry> {
    return this.byAppPath.get(appPath) ?? new Map();
  }

  /**
   * Read a skill's current-state file (Layer 2).
   *
   * Returns the raw JSON object written by the skill's own tools, or null if
   * the skill has not written any state. The schema is skill-defined — the
   * registry treats it as an opaque value and passes it through to the LLM.
   *
   * Path: <appPath>/.airo/skills/<skillName>/state.json
   */
  async readSkillState(skillName: string, appPath: string): Promise<Record<string, unknown> | null> {
    const file = join(appPath, '.airo', 'skills', skillName, 'state.json');
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      logger.warn('applied_skills.state.read_failed', {
        skillName,
        appPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Atomically merge a state patch into a skill's state file.
   *
   * Concurrent calls for the same (appPath, skillName) are serialized via a
   * per-key promise chain — the same pattern used by schedulePersist for
   * applied-skills.json. This prevents a lost-update race where two tools of
   * the same skill fire concurrently: both read the same existing state, then
   * the second write clobbers the first tool's keys.
   *
   * Each tool only needs to return the fields it owns in computeState; this
   * method guarantees those fields are shallow-merged without dropping keys
   * written by other tools of the same skill.
   */
  mergeSkillState(skillName: string, appPath: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const key = `${appPath}::${skillName}`;
    const prev = this.stateWriteChain.get(key) ?? Promise.resolve(undefined);
    const next = prev.then(() => this.applyStatePatch(skillName, appPath, patch)).catch(() => undefined);
    this.stateWriteChain.set(key, next);
    return next;
  }

  private async applyStatePatch(
    skillName: string,
    appPath: string,
    patch: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Guarantee a registry entry exists so the skill surfaces in the applied-skills
    // context message even if it was never explicitly installed via `skill install`.
    // Guidance-only skills (e.g. online-conferencing) define computeState tools but
    // never copy templates, so applied-skills.json would otherwise have no entry for
    // them and their state would be written to disk but never injected into the LLM.
    if (!this.getOrCreate(appPath).has(skillName)) {
      this.recordInstall(skillName, appPath);
    }
    const existing = await this.readSkillState(skillName, appPath) ?? {};
    const merged = { ...existing, ...patch };
    await writeSkillState(skillName, appPath, merged);
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
   * Concurrent callers for the same appPath share a single in-flight read to
   * avoid redundant disk I/O within a single context-loading cycle.
   * Missing or unreadable files are silently ignored.
   */
  hydrateFromAppPath(appPath: string): Promise<void> {
    let inFlight = this.hydrationPromises.get(appPath);
    if (inFlight) return inFlight;
    inFlight = this.hydrateInner(appPath).finally(() => {
      this.hydrationPromises.delete(appPath);
    });
    this.hydrationPromises.set(appPath, inFlight);
    return inFlight;
  }

  private async hydrateInner(appPath: string): Promise<void> {
    const file = join(appPath, '.airo', 'applied-skills.json');
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      logger.warn('applied_skills.hydrate.read_failed', {
        appPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn('applied_skills.hydrate.parse_failed', { appPath });
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    const obj = parsed as Record<string, unknown>;
    const map = this.getOrCreate(appPath);

    if (obj.version !== REGISTRY_FILE_VERSION) {
      logger.warn('applied_skills.hydrate.unknown_version', {
        appPath,
        fileVersion: obj.version,
        supportedVersion: REGISTRY_FILE_VERSION,
      });
      return;
    }

    const skills = obj.skills;
    if (!skills || typeof skills !== 'object') return;
    for (const [skillName, entry] of Object.entries(skills as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      map.set(skillName, {
        ...(typeof e.installedAt === 'string' && { installedAt: e.installedAt }),
        ...(typeof e.completedAt === 'string' && { completedAt: e.completedAt }),
      });
    }
    logger.info('applied_skills.hydrated', { appPath, skillCount: map.size });
  }

  private getOrCreate(appPath: string): Map<string, AppliedSkillEntry> {
    let map = this.byAppPath.get(appPath);
    if (!map) {
      map = new Map();
      this.byAppPath.set(appPath, map);
    }
    return map;
  }

  private schedulePersist(appPath: string): void {
    const prev = this.persistChainByAppPath.get(appPath) ?? Promise.resolve();
    const next = prev.then(() => this.persist(appPath)).catch(() => {});
    this.persistChainByAppPath.set(appPath, next);
  }

  private async persist(appPath: string): Promise<void> {
    const skillsMap = this.byAppPath.get(appPath);
    if (!skillsMap || skillsMap.size === 0) return;

    const payload: AppliedSkillsFile = {
      version: REGISTRY_FILE_VERSION,
      skills: Object.fromEntries(skillsMap),
    };

    const dir = join(appPath, '.airo');
    const file = join(dir, 'applied-skills.json');

    try {
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
      await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
      await fs.rename(tmp, file);
    } catch (error) {
      logger.warn('applied_skills.persist_failed', {
        appPath,
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
 * Path: <appPath>/.airo/skills/<skillName>/state.json
 *
 * Usage in a skill tool:
 *   await writeSkillState('auth', appPath, { provider: 'google', sessionStrategy: 'jwt' });
 */
export async function writeSkillState(
  skillName: string,
  appPath: string,
  state: Record<string, unknown>
): Promise<void> {
  const dir = join(appPath, '.airo', 'skills', skillName);
  const file = join(dir, 'state.json');
  try {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tmp, file);
    logger.info('applied_skills.state.written', { skillName, appPath });
  } catch (error) {
    logger.warn('applied_skills.state.write_failed', {
      skillName,
      appPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
