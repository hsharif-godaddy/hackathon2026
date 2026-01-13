/**
 * SkillToolManager - Central manager for dynamic skill tool lifecycle
 *
 * Handles loading, unloading, and lifecycle management of skill tools using AI SDK's dynamicTool().
 * Features:
 * - Dynamic tool loading from skill directories
 * - Token-based auto-unload (inactivity detection)
 * - LRU eviction when max skills exceeded
 * - Tool name prefixing to prevent collisions
 * - Zod schema validation
 */

import { dynamicTool } from 'ai';
import type { Tool } from 'ai';
import type { z } from 'zod';
import { logger } from '../logging/index.js';
import type { AgentContext } from '@airo/ai-lib';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

/**
 * Skill tool definition interface
 * Exported by skill tools/index.ts files
 */
export interface SkillToolDefinition<TInput = any, TOutput = any> {
  /**
   * Unique tool name within the skill (e.g., 'query')
   * Will be prefixed with skill name: database__query
   */
  name: string;

  /** Description for LLM tool selection */
  description: string;

  /** Zod schema for input validation */
  parameters: z.ZodSchema<TInput>;

  /**
   * Tool execution function
   * Receives validated input and optional context
   */
  execute: (
    input: TInput,
    context?: AgentContext
  ) => Promise<TOutput> | TOutput;

  /** Optional: Tool-specific configuration */
  config?: {
    /** Timeout in milliseconds (default: 30000) */
    timeout?: number;

    /** Whether tool requires app context (default: true) */
    requiresApp?: boolean;

    /** Custom validation function (runs after schema validation) */
    validate?: (input: TInput, context?: AgentContext) => Promise<void> | void;
  };
}

/**
 * Metadata for an active skill
 */
export interface ActiveSkillMetadata {
  /** Name of the skill */
  skillName: string;

  /** Conversation ID this skill is active in */
  conversationId: string;

  /** Timestamp when skill was loaded */
  loadedAt: number;

  /** Token count when skill was last used */
  lastUsedTokenCount: number;

  /** Prefixed tool names for this skill */
  tools: string[];
}

/**
 * Configuration for SkillToolManager
 */
export interface SkillToolConfig {
  /** Tokens of inactivity before auto-unload (default: 3000) */
  inactivityThresholdTokens: number;

  /** Maximum active skills per conversation (default: 3) */
  maxActiveSkills: number;

  /** Enable LRU eviction (default: true) */
  enableLRU: boolean;
}

/**
 * Result of skill registration
 */
export interface SkillRegistrationResult {
  /** Whether registration succeeded */
  success: boolean;

  /** Prefixed tool names that were registered */
  tools: string[];

  /** Error message if registration failed */
  error?: string;
}

/**
 * SkillToolManager - Manages dynamic skill tool lifecycle
 */
export class SkillToolManager {
  private activeSkills = new Map<string, ActiveSkillMetadata>();
  private toolDefinitions = new Map<string, SkillToolDefinition>();
  private config: SkillToolConfig;
  private readonly skillsDir: string;

  constructor(config?: Partial<SkillToolConfig>) {
    // Load configuration from environment variables with defaults
    this.config = {
      inactivityThresholdTokens: parseInt(
        process.env.SKILL_INACTIVITY_THRESHOLD_TOKENS || '3000'
      ),
      maxActiveSkills: parseInt(
        process.env.SKILL_MAX_ACTIVE_SKILLS || '3'
      ),
      enableLRU: process.env.SKILL_LRU_ENABLED !== 'false',
      ...config
    };

    // Get skills directory relative to this file
    const currentDir = dirname(fileURLToPath(import.meta.url));
    this.skillsDir = join(currentDir, '..', 'skills');

    logger.info('skill_tool_manager.initialized', {
      config: this.config
    });
  }

  /**
   * Register a skill and load its tools
   *
   * @param skillName - Name of the skill to load
   * @param conversationId - Conversation ID to associate with
   * @param currentTokenCount - Current token count for the conversation
   * @param context - Optional agent context
   * @returns Registration result with tool names
   */
  async registerSkill(
    skillName: string,
    conversationId: string,
    currentTokenCount: number,
    context?: AgentContext
  ): Promise<SkillRegistrationResult> {
    try {
      // Validate skill name (prevent directory traversal)
      if (!this.validateSkillName(skillName)) {
        throw new Error(
          `Invalid skill name '${skillName}'. Skill names must contain only letters, numbers, hyphens, and underscores.`
        );
      }

      const key = this.getSkillKey(conversationId, skillName);

      // Check if skill is already loaded
      if (this.activeSkills.has(key)) {
        logger.info('skill.already_registered', {
          skillName,
          conversationId
        });

        const metadata = this.activeSkills.get(key)!;
        return {
          success: true,
          tools: metadata.tools
        };
      }

      // Load tool definitions from skill directory
      const toolDefinitions = await this.loadToolDefinitions(skillName);

      if (toolDefinitions.length === 0) {
        logger.warn('skill.no_tools_found', {
          skillName,
          conversationId
        });
        return {
          success: false,
          tools: [],
          error: `Skill '${skillName}' has no tools defined`
        };
      }

      // Store tool definitions with prefixed names
      const prefixedToolNames: string[] = [];

      for (const toolDef of toolDefinitions) {
        const prefixedName = this.prefixToolName(skillName, toolDef.name);
        this.toolDefinitions.set(prefixedName, toolDef);
        prefixedToolNames.push(prefixedName);
      }

      // Register active skill metadata
      this.activeSkills.set(key, {
        skillName,
        conversationId,
        loadedAt: Date.now(),
        lastUsedTokenCount: currentTokenCount,
        tools: prefixedToolNames
      });

      logger.info('skill.registered', {
        skillName,
        conversationId,
        toolCount: prefixedToolNames.length,
        tools: prefixedToolNames,
        currentTokenCount
      });

      return {
        success: true,
        tools: prefixedToolNames
      };
    } catch (error) {
      logger.error('skill.registration.failed', {
        skillName,
        conversationId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        tools: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get dynamicTool instances for active skills in a conversation
   *
   * @param conversationId - Conversation ID
   * @param currentTokenCount - Current token count
   * @param context - Optional agent context
   * @returns Record of tool name to dynamicTool instance
   */
  async getToolsForSkills(
    conversationId: string,
    currentTokenCount: number,
    context?: AgentContext
  ): Promise<Record<string, Tool>> {
    const tools: Record<string, Tool> = {};

    for (const [key, metadata] of this.activeSkills.entries()) {
      if (metadata.conversationId !== conversationId) continue;

      // Create dynamicTool for each tool in the skill
      for (const prefixedToolName of metadata.tools) {
        const toolDef = this.toolDefinitions.get(prefixedToolName);
        if (!toolDef) continue;

        // Create AI SDK dynamicTool
        tools[prefixedToolName] = dynamicTool({
          description: toolDef.description,
          inputSchema: toolDef.parameters as any,
          execute: async (input: any) => {
            // Update last used token count
            this.updateSkillUsage(
              metadata.skillName,
              conversationId,
              currentTokenCount
            );

            // Run custom validation if provided
            if (toolDef.config?.validate) {
              await toolDef.config.validate(input, context);
            }

            // Execute with timeout
            const timeout = toolDef.config?.timeout || 30000;
            const result = await Promise.race([
              toolDef.execute(input, context),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error('Tool execution timeout')),
                  timeout
                )
              )
            ]);

            logger.info('skill.tool.executed', {
              skillName: metadata.skillName,
              toolName: prefixedToolName,
              conversationId
            });

            return result;
          }
        });
      }
    }

    return tools;
  }

  /**
   * Check and unload inactive skills based on token threshold
   * Called via message added hook in parallel with summarization check
   *
   * @param conversationId - Conversation ID to check
   * @param currentTokenCount - Current token count
   * @returns Array of unloaded skill names
   */
  async checkAndUnloadInactiveSkills(
    conversationId: string,
    currentTokenCount: number
  ): Promise<string[]> {
    const unloadedSkills: string[] = [];

    // Check for token-based inactivity
    for (const [key, metadata] of this.activeSkills.entries()) {
      if (metadata.conversationId !== conversationId) continue;

      const tokensSinceLastUse = currentTokenCount - metadata.lastUsedTokenCount;

      if (tokensSinceLastUse >= this.config.inactivityThresholdTokens) {
        logger.debug('skill.marked_for_unload', {
          skillName: metadata.skillName,
          conversationId,
          reason: 'inactive_tokens',
          tokensSinceLastUse,
          threshold: this.config.inactivityThresholdTokens
        });

        this.activeSkills.delete(key);

        // Remove tool definitions
        for (const toolName of metadata.tools) {
          this.toolDefinitions.delete(toolName);
        }

        unloadedSkills.push(metadata.skillName);

        logger.info('skill.unloaded', {
          skillName: metadata.skillName,
          conversationId,
          reason: 'inactive_tokens',
          tokensSinceLastUse,
          inactivityThreshold: this.config.inactivityThresholdTokens,
          lastUsedTokenCount: metadata.lastUsedTokenCount,
          loadedDurationMs: Date.now() - metadata.loadedAt
        });
      }
    }

    // Apply LRU eviction if enabled
    if (this.config.enableLRU) {
      const evicted = this.applyLRUEviction(conversationId);
      unloadedSkills.push(...evicted);
    }

    return unloadedSkills;
  }

  /**
   * Manually unload a skill
   *
   * @param skillName - Name of the skill to unload
   * @param conversationId - Conversation ID
   * @returns Whether the skill was unloaded
   */
  unloadSkill(skillName: string, conversationId: string): boolean {
    const key = this.getSkillKey(conversationId, skillName);
    const metadata = this.activeSkills.get(key);

    if (!metadata) {
      return false;
    }

    // Remove tool definitions
    for (const toolName of metadata.tools) {
      this.toolDefinitions.delete(toolName);
    }

    this.activeSkills.delete(key);

    logger.info('skill.unloaded', {
      skillName,
      conversationId,
      reason: 'manual',
      loadedDurationMs: Date.now() - metadata.loadedAt
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
    const skills: string[] = [];

    for (const metadata of this.activeSkills.values()) {
      if (metadata.conversationId === conversationId) {
        skills.push(metadata.skillName);
      }
    }

    return skills;
  }

  /**
   * Update skill usage (last used token count)
   * Called when a skill's tool is executed
   *
   * @param skillName - Name of the skill
   * @param conversationId - Conversation ID
   * @param currentTokenCount - Current token count
   */
  updateSkillUsage(
    skillName: string,
    conversationId: string,
    currentTokenCount: number
  ): void {
    const key = this.getSkillKey(conversationId, skillName);
    const metadata = this.activeSkills.get(key);

    if (metadata) {
      metadata.lastUsedTokenCount = currentTokenCount;
    }
  }

  /**
   * Apply LRU eviction when max skills exceeded
   * Private helper method
   *
   * @param conversationId - Conversation ID
   * @returns Array of evicted skill names
   */
  private applyLRUEviction(conversationId: string): string[] {
    const skillsForConv = Array.from(this.activeSkills.values())
      .filter(m => m.conversationId === conversationId);

    if (skillsForConv.length <= this.config.maxActiveSkills) {
      return [];
    }

    // Sort by lastUsedTokenCount (ascending = oldest first)
    const sorted = skillsForConv.sort((a, b) =>
      a.lastUsedTokenCount - b.lastUsedTokenCount
    );

    // Evict oldest skills beyond max
    const toEvict = sorted.slice(0, sorted.length - this.config.maxActiveSkills);
    const evictedNames: string[] = [];

    for (const metadata of toEvict) {
      const key = this.getSkillKey(conversationId, metadata.skillName);

      // Remove tool definitions
      for (const toolName of metadata.tools) {
        this.toolDefinitions.delete(toolName);
      }

      this.activeSkills.delete(key);
      evictedNames.push(metadata.skillName);

      logger.info('skill.unloaded', {
        skillName: metadata.skillName,
        conversationId,
        reason: 'lru_eviction',
        lastUsedTokenCount: metadata.lastUsedTokenCount,
        loadedDurationMs: Date.now() - metadata.loadedAt
      });
    }

    return evictedNames;
  }

  /**
   * Load tool definitions from a skill's tools directory
   * Private helper method
   *
   * @param skillName - Name of the skill
   * @returns Array of tool definitions
   */
  private async loadToolDefinitions(skillName: string): Promise<SkillToolDefinition[]> {
    const toolsDir = join(this.skillsDir, skillName, 'tools');

    try {
      // Dynamic import of tools/index.ts
      const indexPath = join(toolsDir, 'index.ts');
      const toolsModule = await import(indexPath);

      // Extract all exported tools
      const tools: SkillToolDefinition[] = [];

      for (const [key, value] of Object.entries(toolsModule)) {
        if (key === 'default') continue; // Skip default export

        if (this.validateToolDefinition(value)) {
          tools.push(value as SkillToolDefinition);
        } else {
          logger.warn('skill.tool.invalid_definition', {
            skillName,
            exportName: key
          });
        }
      }

      return tools;
    } catch (error) {
      logger.error('skill.tool.load_failed', {
        skillName,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Validate tool definition structure
   * Private helper method
   *
   * @param def - Tool definition to validate
   * @returns Whether the definition is valid
   */
  private validateToolDefinition(def: any): def is SkillToolDefinition {
    return (
      typeof def === 'object' &&
      def !== null &&
      typeof def.name === 'string' &&
      typeof def.description === 'string' &&
      typeof def.parameters === 'object' &&
      typeof def.execute === 'function'
    );
  }

  /**
   * Validate skill name to prevent directory traversal
   * Private helper method
   *
   * @param skillName - Skill name to validate
   * @returns Whether the skill name is valid
   */
  private validateSkillName(skillName: string): boolean {
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    return validPattern.test(skillName);
  }

  /**
   * Create prefixed tool name
   * Private helper method
   *
   * @param skillName - Name of the skill
   * @param toolName - Name of the tool
   * @returns Prefixed tool name
   */
  private prefixToolName(skillName: string, toolName: string): string {
    return `${skillName}__${toolName}`;
  }

  /**
   * Get unique key for skill in conversation
   * Private helper method
   *
   * @param conversationId - Conversation ID
   * @param skillName - Skill name
   * @returns Unique key
   */
  private getSkillKey(conversationId: string, skillName: string): string {
    return `${conversationId}:${skillName}`;
  }
}

// Export singleton instance
export const skillToolManager = new SkillToolManager();
