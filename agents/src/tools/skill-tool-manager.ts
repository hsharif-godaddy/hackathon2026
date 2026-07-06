/**
 * SkillToolManager - Central manager for skill tool lifecycle
 *
 * Handles activation/deactivation of pre-registered skill tools.
 * Features:
 * - Pre-registration of all skill tools at startup via buildAllSkillTools
 * - Step-based auto-unload (inactivity detection via prepareStep hook)
 * - Tool name prefixing to prevent collisions
 * - activeTools filtering controls visibility (not runtime injection)
 * - Dynamic post-boot tool injection for runtime-sourced tools (e.g. Stripe MCP)
 */

import type { Tool } from 'ai';
import type { ResolveToolMetadata } from '@airo/ai-transport';
import { createSkillAction } from '@godaddy/agent-observability-events';
import { emitSkillAction } from '@godaddy/agent-otel-sdk';
import { logger } from '../logging/index.js';
import { ConversationSkillState, buildAllSkillTools, buildSkillToolName, type SkillToolRegistry, type SkillHooks, type SkillHookContext, type SkillSessionAnnouncements } from '@airo/ai-skills';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { appliedSkillsRegistry } from './applied-skills-registry.js';
import { createForWorkspace } from '../workspace/index.js';
import type { WorkspaceFiles } from '../workspace/files.js';
import { DevSupervisorError } from '../services/DevSupervisorClient.js';

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

/** Schema version for `.airo/pinned-skills.json`. Bump on breaking changes. */
const PINNED_SKILLS_FILE_VERSION = 1;

const PINNED_SKILLS_PATH = '.airo/pinned-skills.json';

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

  // conversationId -> appId, populated whenever a pin/unpin call provides an
  // appId. Used by `persistPins` to write only the conversations that
  // belong to a given workspace, so co-tenant agent processes do not clobber
  // each other's `.airo/pinned-skills.json`.
  private convToAppId = new Map<string, string>();

  // In-flight (or already settled) hydration promises keyed on appId.
  // Concurrent callers await the same promise so a second context-load
  // cannot read pins before the first finishes parsing the file. Once
  // resolved, the entry stays in the map and subsequent awaits return
  // immediately — same short-circuit semantics the previous Set provided.
  private hydrationPromises = new Map<string, Promise<void>>();

  // Serialize concurrent persist writes per workspace so two near-simultaneous
  // pin/unpin calls do not race. The chain is per-appId because each workspace
  // owns its own file.
  private persistChainByAppId = new Map<string, Promise<void>>();

  // Reverse map: prefixed tool name -> owning skill name. Lets transports
  // enrich tool_start frames with the parent skill without parsing the
  // `{skillName}__{toolName}` shape on the wire. Populated on initialize()
  // and on registerDynamicTools(); read by getSkillNameForTool().
  private toolToSkill = new Map<string, string>();

  constructor() {
    // Get skills directory relative to this file
    const currentDir = dirname(fileURLToPath(import.meta.url));
    this.skillsDir = join(currentDir, '..', 'skills');

    logger.info('skill_tool_manager.initialized', {
      skillsDir: this.skillsDir,
      inactivityThreshold: INACTIVITY_THRESHOLD_STEPS
    });
  }

  private getWorkspaceFiles(appId: string): WorkspaceFiles | null {
    const workspace = createForWorkspace(appId, 'preview');
    return workspace?.files ?? null;
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
      this.toolRegistry = await buildAllSkillTools(this.skillsDir, {
        onStateComputed: async (skillName, appId, statePatch) => {
          if (!appId) return;
          const stateSnapshot = await appliedSkillsRegistry.mergeSkillState(skillName, appId, statePatch);
          if (stateSnapshot) {
            try {
              emitSkillAction({
                eventData: createSkillAction({
                  skillName,
                  skillAction: 'updateState',
                  stateSnapshot,
                  statePatch,
                }),
              });
            } catch (err) {
              logger.warn('skill.otel.emit_failed', { skillName, skillAction: 'updateState', error: err });
            }
          }
        },
        onStateError: (skillName, toolName, error) => {
          logger.warn('skill.state.write_failed', {
            skillName,
            toolName,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      });
      this.initialized = true;

      // Populate the reverse map from the static skill→tools mapping built by
      // buildAllSkillTools. Dynamic tools added later via registerDynamicTools
      // append to this same map.
      for (const [skillName, toolNames] of this.toolRegistry.skillToTools) {
        for (const rawName of toolNames) {
          this.toolToSkill.set(buildSkillToolName(skillName, rawName), skillName);
        }
      }

      const skillCount = this.toolRegistry.skillToTools.size;
      const toolCount = Object.keys(this.toolRegistry.tools).length;

      logger.info('skill_tool_manager.tools_registered', {
        skillCount,
        toolCount,
        skills: Array.from(this.toolRegistry.skillToTools.keys())
      });

      // Pre-fire onLoad hooks so skills with dynamic tools (e.g. MCP) register
      // them before prepareCall snapshots getAllTools(). Without this, MCP tools
      // are only registered when loadSkill fires — after prepareCall has already
      // run — and the AI SDK's executeToolCall silently no-ops any call whose
      // implementation isn't in that snapshot.
      // onLoad is idempotent: it's also called when loadSkill fires mid-turn,
      // and each skill's onLoad handler caches its result, so double-calling is safe.
      for (const [skillName, hooks] of this.toolRegistry.skillHooks) {
        if (hooks.onLoad) {
          try {
            await hooks.onLoad({ skillName });
            logger.info('skill_tool_manager.preload.success', { skillName });
          } catch (error) {
            logger.warn('skill_tool_manager.preload.failed', {
              skillName,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } catch (error) {
      logger.error('skill_tool_manager.initialization_failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Initialize with empty registry so we don't fail completely
      this.toolRegistry = {
        tools: {},
        skillToTools: new Map(),
        skillHooks: new Map(),
        stopAfterToolNames: [],
      };
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
   * Prefixed skill tool names that should stop the agent turn after execution.
   * Declared per tool via SkillToolDefinition.config.stopAfter in the skill's tools/.
   */
  getStopAfterToolNames(): string[] {
    if (!this.toolRegistry) {
      return [];
    }
    return [...this.toolRegistry.stopAfterToolNames];
  }

  /**
   * Register tools that are sourced at runtime (e.g. from an MCP server) into
   * the skill's slot in the tool registry. Safe to call multiple times — a
   * second call with the same skill name and identical tool names is a no-op
   * (existing entries are overwritten with the same value).
   *
   * `rawTools` keys are UN-prefixed tool names (e.g. "products_create"). This
   * method applies buildSkillToolName(skillName, rawName) to produce the
   * prefixed registry key ("stripe__products_create") and records the
   * un-prefixed name in skillToTools so getActiveToolNames() returns the right
   * prefixed names via the existing ConversationSkillState path.
   *
   * Must be called AFTER initialize() so toolRegistry is non-null.
   */
  registerDynamicTools(skillName: string, rawTools: Record<string, Tool>): void {
    if (!this.toolRegistry) {
      logger.warn('skill_tool_manager.register_dynamic.not_initialized', { skillName });
      return;
    }

    const entries = Object.entries(rawTools);
    if (entries.length === 0) return;

    const rawNames: string[] = [];
    for (const [rawName, toolDef] of entries) {
      rawNames.push(rawName);
      const prefixed = buildSkillToolName(skillName, rawName);
      this.toolToSkill.set(prefixed, skillName);
      // Wrap execute to log MCP tool execution lifecycle events with skill/tool
      // name context. agent-factory's wrapToolsWithHooks also wraps these tools
      // at the outer layer; this inner wrapper adds the structured skillName /
      // toolName fields that the outer wrapper doesn't carry.
      const originalExecute = toolDef.execute;
      this.toolRegistry.tools[prefixed] = {
        ...toolDef,
        execute: typeof originalExecute === 'function'
          ? async (args: unknown, options: unknown) => {
              logger.info('skill_tool_manager.dynamic_tool.execution.start', {
                skillName,
                toolName: prefixed,
              });
              try {
                const result = await (originalExecute as (args: unknown, options: unknown) => Promise<unknown>)(args, options);
                logger.info('skill_tool_manager.dynamic_tool.execution.complete', {
                  skillName,
                  toolName: prefixed,
                });
                return result;
              } catch (err) {
                logger.error('skill_tool_manager.dynamic_tool.execution.error', {
                  skillName,
                  toolName: prefixed,
                  error: err instanceof Error ? err.message : String(err),
                });
                throw err;
              }
            }
          : originalExecute,
      };
    }

    // Merge with any static tool names already registered for this skill.
    const existing = this.toolRegistry.skillToTools.get(skillName) ?? [];
    const merged = Array.from(new Set([...existing, ...rawNames]));
    this.toolRegistry.skillToTools.set(skillName, merged);

    // Update ConversationSkillState so getActiveToolNames reflects MCP tools
    // for any conversation that already has the skill active.
    this.conversationState.setSkillTools(skillName, merged);

    logger.info('skill_tool_manager.dynamic_tools_registered', {
      skillName,
      added: rawNames.length,
      total: merged.length,
      tools: rawNames,
    });
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
   * Reverse lookup: given a prefixed tool name (`{skillName}__{toolName}`),
   * return the owning skill name, or undefined if the tool is not a skill
   * tool. Used by transports to enrich tool_start frames with `skillName`
   * metadata so the client does not parse the wire-name shape itself.
   */
  getSkillNameForTool(prefixedName: string): string | undefined {
    return this.toolToSkill.get(prefixedName);
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
  pinSkill(conversationId: string, skillName: string, appId?: string): SkillRegistrationResult {
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

    if (appId) {
      this.convToAppId.set(conversationId, appId);
      this.schedulePersist(appId);
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
  unpinSkill(conversationId: string, skillName: string, appId?: string): void {
    const set = this.pinnedByConversation.get(conversationId);
    if (!set) return;
    const removed = set.delete(skillName);
    if (set.size === 0) {
      this.pinnedByConversation.delete(conversationId);
    }

    const resolvedAppId = appId ?? this.convToAppId.get(conversationId);
    if (resolvedAppId) {
      this.schedulePersist(resolvedAppId);
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
  clearConversation(conversationId: string, appId?: string): void {
    this.conversationState.clearConversation(conversationId);
    this.pinnedByConversation.delete(conversationId);
    const knownAppId = this.convToAppId.get(conversationId);
    this.convToAppId.delete(conversationId);
    const resolvedAppId = appId ?? knownAppId;
    if (resolvedAppId) {
      this.schedulePersist(resolvedAppId);
    }
  }

  /**
   * Lazy-load the per-workspace pinned-skills file into memory. Idempotent:
   * concurrent callers await the same in-flight promise; settled callers
   * return immediately. Missing or unreadable files are not fatal — the
   * conversation simply starts with no pins (matching the in-memory default).
   *
   * Persistence shape (`.airo/pinned-skills.json`, v1):
   * `{ "version": 1, "conversations": { "<conversationId>": ["skillName", ...] } }`
   *
   * Existing in-memory pins are preserved: the set is unioned with the
   * file's contents. This avoids dropping pins set in this process before
   * the first context-load triggered hydration.
   */
  hydrateFromWorkspace(appId: string): Promise<void> {
    let inFlight = this.hydrationPromises.get(appId);
    if (inFlight) return inFlight;
    inFlight = this.hydrateFromWorkspaceInner(appId);
    this.hydrationPromises.set(appId, inFlight);
    return inFlight;
  }

  private async hydrateFromWorkspaceInner(appId: string): Promise<void> {
    const files = this.getWorkspaceFiles(appId);
    if (!files) return;

    let raw: string;
    try {
      raw = await files.readText({ path: PINNED_SKILLS_PATH });
    } catch (error) {
      if (error instanceof DevSupervisorError && error.code === 'not_found') return;
      logger.warn('skill.pinned.hydrate.read_failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      logger.warn('skill.pinned.hydrate.parse_failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    const conversations = this.extractConversationsForVersion(parsed, appId);
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
        this.convToAppId.set(convId, appId);
      } else {
        this.pinnedByConversation.delete(convId);
      }
    }

    logger.info('skill.pinned.hydrated', { appId, restored });
  }

  private extractConversationsForVersion(
    parsed: object,
    appId: string,
  ): Record<string, unknown> | null {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.version !== 'number') {
      logger.warn('skill.pinned.hydrate.missing_version', { appId });
      return null;
    }
    if (obj.version !== PINNED_SKILLS_FILE_VERSION) {
      logger.warn('skill.pinned.hydrate.unknown_version', {
        appId,
        fileVersion: obj.version,
        supportedVersion: PINNED_SKILLS_FILE_VERSION,
      });
      return null;
    }
    const conversations = obj.conversations;
    if (!conversations || typeof conversations !== 'object') return null;
    return conversations as Record<string, unknown>;
  }

  /**
   * Schedule a persist of this workspace's pins. Writes are serialized
   * per-appId to avoid races between near-simultaneous pin/unpin calls.
   * Failures are logged but do not propagate — in-memory state is authoritative.
   */
  private schedulePersist(appId: string): void {
    const prev = this.persistChainByAppId.get(appId) ?? Promise.resolve();
    const next = prev.then(() => this.persistPins(appId)).catch(() => {
      // already logged inside persistPins; swallow so the chain stays alive.
    });
    this.persistChainByAppId.set(appId, next);
  }

  private async persistPins(appId: string): Promise<void> {
    const entries: [string, string[]][] = [];
    for (const [convId, set] of this.pinnedByConversation) {
      if (this.convToAppId.get(convId) !== appId) continue;
      if (set.size === 0) continue;
      entries.push([convId, Array.from(set)]);
    }

    let kept = entries;
    if (entries.length > MAX_PERSISTED_CONVERSATIONS) {
      const dropped = entries.length - MAX_PERSISTED_CONVERSATIONS;
      kept = entries.slice(-MAX_PERSISTED_CONVERSATIONS);
      logger.warn('skill.pinned.persist.cap_exceeded', {
        appId,
        total: entries.length,
        dropped,
        cap: MAX_PERSISTED_CONVERSATIONS,
      });
    }

    const payload: PinnedSkillsFileV1 = {
      version: PINNED_SKILLS_FILE_VERSION,
      conversations: Object.fromEntries(kept),
    };

    const files = this.getWorkspaceFiles(appId);
    if (!files) {
      logger.warn('skill.pinned.persist_failed', { appId, error: 'workspace not found' });
      return;
    }

    try {
      await files.write({
        path: PINNED_SKILLS_PATH,
        content: JSON.stringify(payload, null, 2),
      });
    } catch (error) {
      logger.warn('skill.pinned.persist_failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Run a lifecycle hook for a skill if one is registered.
   * Non-fatal: logs warnings on failure but never throws.
   * Returns whatever the hook handler returns (undefined when no hook is registered).
   */
  async runHook(
    skillName: string,
    event: keyof SkillHooks,
    context: SkillHookContext
  ): Promise<unknown> {
    const hooks = this.toolRegistry?.skillHooks.get(skillName);
    if (!hooks) return undefined;

    const handler = hooks[event];
    if (!handler) return undefined;

    try {
      const result = await (handler as (ctx: SkillHookContext) => Promise<unknown>)(context);
      logger.info('skill.hook.success', { skillName, event });
      return result;
    } catch (error) {
      logger.warn('skill.hook.failed', {
        skillName,
        event,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  /**
   * Validate skill name to prevent directory traversal
   */
  private validateSkillName(skillName: string): boolean {
    const validPattern = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)?$/;
    return validPattern.test(skillName);
  }
    /**
   * Names of registered skills that expose an `onSessionStart` hook. Used by the
   * generic session-start bootstrap to discover announcement providers without
   * hard-coding any skill name (see Self-Containment Rule in skills/README.md).
   */
  listSkillsWithSessionStart(): string[] {
    if (!this.toolRegistry) return [];
    const names: string[] = [];
    for (const [skillName, hooks] of this.toolRegistry.skillHooks) {
      if (typeof hooks.onSessionStart === 'function') {
        names.push(skillName);
      }
    }
    return names;
  }

  


  /**
   * Run a skill's `onSessionStart` hook. Non-fatal: returns null when the skill
   * has no such hook or the hook throws, so a broken skill never blocks context
   * assembly.
   */
  async runSessionStartHook(
    skillName: string,
    context: SkillHookContext
  ): Promise<SkillSessionAnnouncements | null> {
    const hooks = this.toolRegistry?.skillHooks.get(skillName);
    if (!hooks?.onSessionStart) return null;

    try {
      const result = await hooks.onSessionStart(context);
      return result ?? null;
    } catch (error) {
      logger.warn('skill.hook.failed', {
        skillName,
        event: 'onSessionStart',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
    /**
   * Collect the not-yet-adopted capabilities every footprint-bearing skill reports
   * for this app. A behaviour-neutral wrapper over `onSessionStart` so consumers
   * other than the session-start bootstrap (e.g. the "Continue building"
   * next-actions service) can ask the generic question "anything to announce for
   * this app?" without naming any skill (see Self-Containment Rule). Each hook runs
   * defensively; skills with no footprint return null and are dropped.
   */
  async collectAppAnnouncements(
    context: Omit<SkillHookContext, 'skillName'>
  ): Promise<Array<{ skillName: string; report: SkillSessionAnnouncements }>> {
    const results: Array<{ skillName: string; report: SkillSessionAnnouncements }> = [];
    const skillNames = this.listSkillsWithSessionStart();
    for (const skillName of skillNames) {
      const report = await this.runSessionStartHook(skillName, { ...context, skillName });
      if (report) {
        results.push({ skillName, report });
      }
    }

    // Behaviour 1 fan-out summary: how many announcing skills were polled, how many
    // had a footprint in this app, and the total pending capabilities reported back
    // (the candidates the next-actions service will merge into "Continue building").
    logger.info('skill.announcements.collected', {
      appId: context.appId,
      skillsChecked: skillNames.length,
      skillsReporting: results.length,
      totalAnnouncements: results.reduce((sum, r) => sum + r.report.announcements.length, 0),
    });

    return results;
  }
}

// Export singleton instance
export const skillToolManager = new SkillToolManager();

/**
 * Shared resolver injected into both transports (WS config + SSE deps) so the
 * `skillName` enrichment of tool_result/tool_error frames has a single source.
 * Maps a prefixed `{skill}__{tool}` name to its owning skill; non-skill tools
 * resolve to undefined (no-op merge).
 */
export const resolveSkillToolMetadata: ResolveToolMetadata = (toolName: string) => {
  const skillName = skillToolManager.getSkillNameForTool(toolName);
  return skillName ? { skillName } : undefined;
};
