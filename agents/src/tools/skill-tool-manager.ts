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
import { ConversationSkillState, buildAllSkillTools, buildSkillToolName, type SkillToolRegistry, type SkillHooks, type SkillHookContext } from '@airo/ai-lib';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

/** Number of steps of inactivity before auto-unloading a skill (configurable via env) */
const INACTIVITY_THRESHOLD_STEPS = parseInt(process.env.SKILL_INACTIVITY_THRESHOLD_STEPS || '30', 10);

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
    return this.conversationState.cleanupInactiveSkills(
      conversationId,
      currentStep,
      INACTIVITY_THRESHOLD_STEPS
    );
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
