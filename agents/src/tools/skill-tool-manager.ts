/**
 * SkillToolManager - Central manager for skill tool lifecycle
 *
 * Handles activation/deactivation of pre-registered skill tools.
 * Features:
 * - Pre-registration of all skill tools at startup via buildAllSkillTools
 * - Step-based auto-unload (inactivity detection via prepareStep hook)
 * - Tool name prefixing to prevent collisions
 * - activeTools filtering controls visibility (not runtime injection)
 */

import type { Tool } from 'ai';
import { logger } from '../logging/index.js';
import { ConversationSkillState, buildAllSkillTools, buildSkillToolName, type SkillToolRegistry, type SkillHooks, type SkillHookContext } from '@airo/ai-skills';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { promises as fs } from 'fs';

/** Number of steps of inactivity before auto-unloading a skill (configurable via env) */
const INACTIVITY_THRESHOLD_STEPS = parseInt(process.env.SKILL_INACTIVITY_THRESHOLD_STEPS || '30', 10);

/**
 * Hard cap on conversations persisted to a single workspace's pinned-skills
 * file. Failsafe for the absence of an automatic eviction path: if entries
 * exceed this, the oldest are dropped on next persist (Map insertion order).
 * In practice most workspaces have ~1 active conversation, so this only
 * trips on long-running misuse.
 */
const MAX_PERSISTED_CONVERSATIONS = 100;

/** Schema version for `<appPath>/.airo/pinned-skills.json`. Bump on breaking changes. */
const PINNED_SKILLS_FILE_VERSION = 1;

interface PinnedSkillsFileV1 {
  version: 1;
  conversations: Record<string, string[]>;
}

/**
 * Result of skill activation
 */
export interface SkillRegistrationResult {
  /** Whether activation succeeded */
  success: boolean;

  /** Prefixed tool names for this skill */
  tools: string[];

  /** Error message if activation failed */
  error?: string;
}

/**
 * SkillToolManager - Manages skill tool lifecycle with pre-registration
 */
export class SkillToolManager {
  private readonly skillsDir: string;
  private toolRegistry: SkillToolRegistry | null = null;
  private initialized = false;

  // Step-based state for prepareStep integration
  private conversationState = new ConversationSkillState();

  // Pinned skills per conversation. Pinned skills are injected into the per-turn
  // system context and bypass inactivity/LRU cleanup. Pinning persists until
  // explicitly unpinned.
  private pinnedByConversation = new Map<string, Set<string>>();

  // conversationId -> appPath, populated whenever a pin/unpin call provides an
  // appPath. Used by `persistPins` to write only the conversations that
  // belong to a given workspace, so co-tenant agent processes do not clobber
  // each other's `.airo/pinned-skills.json`.
  private convToAppPath = new Map<string, string>();

  // In-flight (or already settled) hydration promises keyed on appPath.
  // Concurrent callers await the same promise so a second context-load
  // cannot read pins before the first finishes parsing the file. Once
  // resolved, the entry stays in the map and subsequent awaits return
  // immediately — same short-circuit semantics the previous Set provided.
  private hydrationPromises = new Map<string, Promise<void>>();

  // Serialize concurrent persist writes per workspace so two near-simultaneous
  // pin/unpin calls do not race on `tmp -> rename`. The chain is per-appPath
  // because each workspace owns its own file.
  private persistChainByAppPath = new Map<string, Promise<void>>();

  constructor() {
    // Get skills directory relative to this file
    const currentDir = dirname(fileURLToPath(import.meta.url));
    this.skillsDir = join(currentDir, '..', 'skills');

    logger.info('skill_tool_manager.initialized', {
      skillsDir: this.skillsDir,
      inactivityThreshold: INACTIVITY_THRESHOLD_STEPS
    });
  }

  /**
   * Initialize the manager by pre-registering all skill tools
   * Must be called before using the manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.toolRegistry = await buildAllSkillTools(this.skillsDir);
      this.initialized = true;

      const skillCount = this.toolRegistry.skillToTools.size;
      const toolCount = Object.keys(this.toolRegistry.tools).length;

      logger.info('skill_tool_manager.tools_registered', {
        skillCount,
        toolCount,
        skills: Array.from(this.toolRegistry.skillToTools.keys())
      });
    } catch (error) {
      logger.error('skill_tool_manager.initialization_failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Initialize with empty registry so we don't fail completely
      this.toolRegistry = { tools: {}, skillToTools: new Map(), skillHooks: new Map() };
      this.initialized = true;
    }
  }

  /**
   * Get all pre-registered skill tools
   * These are added to the agent's base tools at startup
   */
  getAllTools(): Record<string, Tool> {
    if (!this.toolRegistry) {
      return {};
    }
    return this.toolRegistry.tools;
  }

  /**
   * Get all pre-registered skill tool names
   * Used by prepareStep to filter skill tools from base tools
   */
  getSkillToolNames(): string[] {
    if (!this.toolRegistry) {
      return [];
    }
    return Object.keys(this.toolRegistry.tools);
  }

  /**
   * Activate a skill for a conversation
   *
   * @param skillName - Name of the skill to activate
   * @param conversationId - Conversation ID to associate with
   * @returns Activation result with tool names
   */
  registerSkill(
    skillName: string,
    conversationId: string
  ): SkillRegistrationResult {
    // Validate skill name (prevent directory traversal)
    if (!this.validateSkillName(skillName)) {
      return {
        success: false,
        tools: [],
        error: `Invalid skill name '${skillName}'. Skill names must contain only letters, numbers, hyphens, and underscores.`
      };
    }

    // Check if skill has tools registered
    const toolNames = this.toolRegistry?.skillToTools.get(skillName);
    if (!toolNames || toolNames.length === 0) {
      logger.warn('skill.no_tools_found', {
        skillName,
        conversationId,
        availableSkills: this.toolRegistry ? Array.from(this.toolRegistry.skillToTools.keys()) : []
      });
      return {
        success: false,
        tools: [],
        error: `Skill '${skillName}' has no tools registered`
      };
    }

    // Build prefixed tool names
    const prefixedToolNames = toolNames.map(name => buildSkillToolName(skillName, name));

    // Register tools with conversation state for activeTools filtering
    this.conversationState.setSkillTools(skillName, toolNames);

    // Activate skill in step-based state (step 0 on initial activation)
    this.conversationState.activate(conversationId, skillName, 0);

    logger.info('skill.activated', {
      skillName,
      conversationId,
      toolCount: prefixedToolNames.length,
      tools: prefixedToolNames
    });

    return {
      success: true,
      tools: prefixedToolNames
    };
  }

  /**
   * Manually deactivate a skill
   *
   * @param skillName - Name of the skill to deactivate
   * @param conversationId - Conversation ID
   * @returns Whether the skill was deactivated
   */
  unloadSkill(skillName: string, conversationId: string): boolean {
    if (this.isPinned(conversationId, skillName)) {
      logger.warn('skill.unload.blocked_pinned', {
        skillName,
        conversationId
      });
      return false;
    }

    this.conversationState.deactivate(conversationId, skillName);

    logger.info('skill.deactivated', {
      skillName,
      conversationId,
      reason: 'manual'
    });

    return true;
  }

  /**
   * Get active skills for a conversation
   *
   * @param conversationId - Conversation ID
   * @returns Array of active skill names
   */
  getActiveSkills(conversationId: string): string[] {
    const activeSkillStates = this.conversationState.getActiveSkills(conversationId);
    return Array.from(activeSkillStates.keys());
  }

  /**
   * Pin a skill to a conversation. Idempotent — pinning an already-pinned
   * skill is a no-op. Pinned skills bypass inactivity cleanup and cannot be
   * unloaded until they are first unpinned.
   *
   * Returns success/failure so callers can surface invalid names (typos,
   * unknown skills) rather than silently storing a name that will fail to
   * load every turn.
   */
  pinSkill(conversationId: string, skillName: string, appPath?: string): SkillRegistrationResult {
    if (!this.validateSkillName(skillName)) {
      return {
        success: false,
        tools: [],
        error: `Invalid skill name '${skillName}'. Skill names must contain only letters, numbers, hyphens, and underscores.`
      };
    }

    // Existence check is best-effort: only enforced when the registry has
    // been initialized. Avoids false negatives in unit tests that construct
    // a fresh manager without calling initialize().
    if (this.toolRegistry && !this.toolRegistry.skillToTools.has(skillName)) {
      const available = Array.from(this.toolRegistry.skillToTools.keys());
      return {
        success: false,
        tools: [],
        error: `Skill '${skillName}' is not registered. Available skills: ${available.join(', ')}`
      };
    }

    let set = this.pinnedByConversation.get(conversationId);
    if (!set) {
      set = new Set<string>();
      this.pinnedByConversation.set(conversationId, set);
    }
    set.add(skillName);

    if (appPath) {
      this.convToAppPath.set(conversationId, appPath);
      this.schedulePersist(appPath);
    }

    logger.info('skill.pinned', {
      conversationId,
      skill: skillName,
      totalPinned: set.size
    });

    return { success: true, tools: [] };
  }

  /**
   * Unpin a skill. No-op if not pinned. Does not unload the skill's tools;
   * the caller can follow up with `unloadSkill` if desired.
   */
  unpinSkill(conversationId: string, skillName: string, appPath?: string): void {
    const set = this.pinnedByConversation.get(conversationId);
    if (!set) return;
    const removed = set.delete(skillName);
    if (set.size === 0) {
      this.pinnedByConversation.delete(conversationId);
    }

    const persistPath = appPath ?? this.convToAppPath.get(conversationId);
    if (persistPath) {
      this.schedulePersist(persistPath);
    }

    if (removed) {
      logger.info('skill.unpinned', {
        conversationId,
        skill: skillName
      });
    }
  }

  /** Whether a skill is pinned in a given conversation. */
  isPinned(conversationId: string, skillName: string): boolean {
    return this.pinnedByConversation.get(conversationId)?.has(skillName) ?? false;
  }

  /** List of pinned skill names for a conversation (empty if none). */
  getPinnedSkills(conversationId: string): string[] {
    const set = this.pinnedByConversation.get(conversationId);
    return set ? Array.from(set) : [];
  }

  /**
   * Get prefixed tool names for all active skills in a conversation
   * Used by prepareStep to set activeTools
   * Implements SkillToolProvider.getActiveToolNames
   */
  getActiveToolNames(conversationId: string): string[] {
    return this.conversationState.getActiveToolNames(conversationId);
  }

  /**
   * Activate a skill for a conversation (step-based tracking)
   * Implements SkillToolProvider.activateSkill
   */
  activateSkill(conversationId: string, skillName: string, stepNumber: number): void {
    this.conversationState.activate(conversationId, skillName, stepNumber);
  }

  /**
   * Update skill usage when its tool is called (step-based tracking)
   * Implements SkillToolProvider.updateSkillUsage
   */
  updateSkillUsage(conversationId: string, skillName: string, stepNumber: number): void {
    this.conversationState.updateLastUsed(conversationId, skillName, stepNumber);
  }

  /**
   * Cleanup inactive skills based on step threshold
   * Implements SkillToolProvider.cleanupInactiveSkills
   */
  cleanupInactiveSkills(conversationId: string, currentStep: number): string[] {
    const removed = this.conversationState.cleanupInactiveSkills(
      conversationId,
      currentStep,
      INACTIVITY_THRESHOLD_STEPS
    );
    const pinned = this.pinnedByConversation.get(conversationId);
    if (!pinned || pinned.size === 0) return removed;
    // The inner cleanup already mutated active-skill state. Re-activate any
    // pinned skills it dropped so their tools remain visible — pinning is
    // documented to bypass inactivity cleanup, so resetting lastUsedStep is
    // intentional (pinned skills repeatedly bypass cleanup).
    for (const name of removed) {
      if (pinned.has(name)) {
        this.conversationState.activate(conversationId, name, currentStep);
      }
    }
    return removed.filter((name) => !pinned.has(name));
  }

  /**
   * Clear all per-conversation state (active skills + pinned skills).
   * Mirrors `ConversationSkillState.clearConversation` so the singleton
   * doesn't accumulate pin entries across long-lived agent processes.
   */
  clearConversation(conversationId: string, appPath?: string): void {
    this.conversationState.clearConversation(conversationId);
    this.pinnedByConversation.delete(conversationId);
    const knownPath = this.convToAppPath.get(conversationId);
    this.convToAppPath.delete(conversationId);
    // Prefer the explicit caller-supplied path so a conversation deleted
    // before the agent process ever observed it (e.g. cross-process delete
    // immediately after restart) still has its disk entry removed.
    const persistPath = appPath ?? knownPath;
    if (persistPath) {
      this.schedulePersist(persistPath);
    }
  }

  /**
   * Lazy-load the per-workspace pinned-skills file into memory. Idempotent:
   * concurrent callers await the same in-flight promise; settled callers
   * return immediately. Missing or unreadable files are not fatal — the
   * conversation simply starts with no pins (matching the in-memory default).
   *
   * Persistence shape (`<appPath>/.airo/pinned-skills.json`, v1):
   * `{ "version": 1, "conversations": { "<conversationId>": ["skillName", ...] } }`
   *
   * Existing in-memory pins are preserved: the set is unioned with the
   * file's contents. This avoids dropping pins set in this process before
   * the first context-load triggered hydration.
   */
  hydrateFromAppPath(appPath: string): Promise<void> {
    // Not `async`: an async wrapper would create a fresh promise on every
    // call, breaking the in-flight dedupe. Return the cached promise
    // reference directly so concurrent callers await the same instance.
    let inFlight = this.hydrationPromises.get(appPath);
    if (inFlight) return inFlight;
    inFlight = this.hydrateFromAppPathInner(appPath);
    this.hydrationPromises.set(appPath, inFlight);
    return inFlight;
  }

  private async hydrateFromAppPathInner(appPath: string): Promise<void> {
    const file = join(appPath, '.airo', 'pinned-skills.json');
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      logger.warn('skill.pinned.hydrate.read_failed', {
        appPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      logger.warn('skill.pinned.hydrate.parse_failed', {
        appPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    const conversations = this.extractConversationsForVersion(parsed, appPath);
    if (!conversations) return;

    let restored = 0;
    for (const [convId, value] of Object.entries(conversations)) {
      if (!Array.isArray(value)) continue;
      let set = this.pinnedByConversation.get(convId);
      if (!set) {
        set = new Set<string>();
        this.pinnedByConversation.set(convId, set);
      }
      for (const entry of value) {
        if (typeof entry === 'string' && this.validateSkillName(entry)) {
          set.add(entry);
          restored++;
        }
      }
      if (set.size > 0) {
        this.convToAppPath.set(convId, appPath);
      } else {
        this.pinnedByConversation.delete(convId);
      }
    }

    logger.info('skill.pinned.hydrated', { appPath, restored });
  }

  /**
   * Resolve the `conversations` map from a parsed file payload. Rejects
   * unknown versions so a future v2 file does not get silently misread by
   * an old agent process.
   */
  private extractConversationsForVersion(
    parsed: object,
    appPath: string
  ): Record<string, unknown> | null {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.version !== 'number') {
      logger.warn('skill.pinned.hydrate.missing_version', { appPath });
      return null;
    }
    if (obj.version !== PINNED_SKILLS_FILE_VERSION) {
      logger.warn('skill.pinned.hydrate.unknown_version', {
        appPath,
        fileVersion: obj.version,
        supportedVersion: PINNED_SKILLS_FILE_VERSION
      });
      return null;
    }
    const conversations = obj.conversations;
    if (!conversations || typeof conversations !== 'object') return null;
    return conversations as Record<string, unknown>;
  }

  /**
   * Schedule an atomic persist of this workspace's pins. Writes are
   * serialized per-`appPath` to avoid `tmp -> rename` races between two
   * near-simultaneous pin/unpin calls. Failures are logged but do not
   * propagate — the in-memory state stays authoritative.
   */
  private schedulePersist(appPath: string): void {
    const prev = this.persistChainByAppPath.get(appPath) ?? Promise.resolve();
    const next = prev.then(() => this.persistPins(appPath)).catch(() => {
      // already logged inside persistPins; swallow so the chain stays alive.
    });
    this.persistChainByAppPath.set(appPath, next);
  }

  private async persistPins(appPath: string): Promise<void> {
    // Map iteration order is insertion order, so the most-recently-added
    // conversations live at the end. If we exceed the cap, drop from the
    // front (oldest first) — coarse but matches the failsafe intent.
    const entries: [string, string[]][] = [];
    for (const [convId, set] of this.pinnedByConversation) {
      if (this.convToAppPath.get(convId) !== appPath) continue;
      if (set.size === 0) continue;
      entries.push([convId, Array.from(set)]);
    }

    let dropped = 0;
    let kept = entries;
    if (entries.length > MAX_PERSISTED_CONVERSATIONS) {
      dropped = entries.length - MAX_PERSISTED_CONVERSATIONS;
      kept = entries.slice(-MAX_PERSISTED_CONVERSATIONS);
      logger.warn('skill.pinned.persist.cap_exceeded', {
        appPath,
        total: entries.length,
        dropped,
        cap: MAX_PERSISTED_CONVERSATIONS
      });
    }

    const payload: PinnedSkillsFileV1 = {
      version: PINNED_SKILLS_FILE_VERSION,
      conversations: Object.fromEntries(kept)
    };

    const dir = join(appPath, '.airo');
    const file = join(dir, 'pinned-skills.json');

    try {
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
      await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
      await fs.rename(tmp, file);
    } catch (error) {
      logger.warn('skill.pinned.persist_failed', {
        appPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Run a lifecycle hook for a skill if one is registered.
   * Non-fatal: logs warnings on failure but never throws.
   */
  async runHook(
    skillName: string,
    event: keyof SkillHooks,
    context: SkillHookContext
  ): Promise<void> {
    const hooks = this.toolRegistry?.skillHooks.get(skillName);
    if (!hooks) return;

    const handler = hooks[event];
    if (!handler) return;

    try {
      await handler(context);
      logger.info('skill.hook.success', { skillName, event });
    } catch (error) {
      logger.warn('skill.hook.failed', {
        skillName,
        event,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Validate skill name to prevent directory traversal
   */
  private validateSkillName(skillName: string): boolean {
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    return validPattern.test(skillName);
  }
}

// Export singleton instance
export const skillToolManager = new SkillToolManager();
