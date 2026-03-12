import { createTool, type Tool, type AgentContext } from '@airo/ai-lib';
import { z } from 'zod';
import { SkillLoaderTool } from '../skill-loader-tool.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { skillToolManager } from '../skill-tool-manager.js';
import { logger } from '../../logging/index.js';

/**
 * Unified Skill Management Tool for AI-Lib
 *
 * Provides three actions for managing skills:
 * - list: Show all available skills with descriptions from YAML frontmatter
 * - load: Load skill instructions into context (without templates)
 * - install: Directly copy skill template files to app directory
 */
export const skillAITool: Tool = createTool(
  'Manage skills - list, load, unload, or install. Skills provide specialized knowledge and tools. Use "list" to discover skills, "load" to activate skill instructions and tools, "unload" to remove skill tools, "install" to copy templates.',
  z.object({
    action: z.enum(['list', 'load', 'unload', 'install']).describe('Action: "list" (show skills), "load" (activate skill+tools), "unload" (remove tools), "install" (copy templates)'),
    skill: z.string().optional().describe('Skill name (required for load, unload, install)'),
  }),
  async (input, context?: AgentContext) => {
    const skillLoader = new SkillLoaderTool();
    const appRepo = new AppRepository();

    // List action - show all available skills
    if (input.action === 'list') {
      const result = await skillLoader.listSkills();

      if (!result.success) {
        throw new Error(result.error || 'Failed to list skills');
      }

      return {
        skills: result.skills,
        count: result.skills?.length || 0,
        message: `Found ${result.skills?.length || 0} available skills. Review descriptions to find the right skill for your task.`
      };
    }

    // Load and install actions require skill name
    if (!input.skill) {
      throw new Error(`Skill name is required for action "${input.action}"`);
    }

    // Load action - load instructions AND activate skill tools
    if (input.action === 'load') {
      const result = await skillLoader.loadSkill({ skill: input.skill });

      if (!result.success) {
        throw new Error(result.error || 'Failed to load skill');
      }

      // Activate skill tools (pre-registered at startup, this enables activeTools filtering)
      const conversationId = context?.metadata?.conversationId as string | undefined;

      // Run onLoad hook (always, regardless of tool registration outcome)
      const appId = context?.metadata?.appId as string | undefined;
      const app = appId ? appRepo.findById(appId) : undefined;
      await skillToolManager.runHook(input.skill, 'onLoad', {
        skillName: input.skill,
        appPath: app?.path,
        appId
      });

      if (conversationId) {
        const toolResult = skillToolManager.registerSkill(input.skill, conversationId);

        if (!toolResult.success) {
          logger.warn('skill.tools.activation_failed', {
            skill: input.skill,
            conversationId,
            error: toolResult.error
          });

          return {
            skill: result.skill,
            instructions: result.instructions,
            toolsAvailable: [],
            message: `Skill '${result.skill}' loaded with instructions only. Tool activation failed: ${toolResult.error}`
          };
        }

        // Return skill information - tools are now visible via prepareStep/activeTools
        return {
          skill: result.skill,
          instructions: result.instructions,
          toolsAvailable: toolResult.tools,
          message: `Skill '${result.skill}' loaded with ${toolResult.tools.length} tools: ${toolResult.tools.join(', ')}. The tools are now available for use.`
        };
      }

      // No conversationId - return instructions only
      return {
        skill: result.skill,
        instructions: result.instructions,
        toolsAvailable: [],
        message: `Skill '${result.skill}' loaded with instructions. No conversation context available for tool activation.`
      };
    }

    // NEW: Unload action - manually remove skill tools
    if (input.action === 'unload') {
      const conversationId = context?.metadata?.conversationId as string | undefined;

      if (!conversationId) {
        throw new Error('Conversation ID not found in context. Unload action requires conversation context.');
      }

      const success = skillToolManager.unloadSkill(input.skill, conversationId);

      if (!success) {
        return {
          success: false,
          skill: input.skill,
          message: `Skill '${input.skill}' is not currently loaded or does not exist.`
        };
      }

      // Run onUnload hook
      const appId = context?.metadata?.appId as string | undefined;
      await skillToolManager.runHook(input.skill, 'onUnload', {
        skillName: input.skill,
        appId
      });

      return {
        success: true,
        skill: input.skill,
        message: `Skill '${input.skill}' has been unloaded. Its tools are no longer available.`
      };
    }

    // Install action - directly copy template files to app
    if (input.action === 'install') {
      // Get appId from context
      const appId = context?.metadata?.appId as string | undefined;

      if (!appId) {
        throw new Error('App ID not found in context. Install action requires app context.');
      }

      // Look up app path
      const app = appRepo.findById(appId);
      if (!app) {
        throw new Error(`App not found: ${appId}`);
      }

      // Install templates directly
      const result = await skillLoader.installTemplates({
        skill: input.skill,
        appPath: app.path,
        appId
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to install skill templates');
      }

      // Run onInstall hook
      await skillToolManager.runHook(input.skill, 'onInstall', {
        skillName: input.skill,
        appPath: app.path,
        appId
      });

      // Build response with dependency info
      const response: Record<string, unknown> = {
        skill: result.skill,
        filesInstalled: result.filesInstalled,
        installedFiles: result.installedFiles,
        message: `Skill '${result.skill}' installed successfully. ${result.filesInstalled} files copied to ${app.path}`
      };

      // Include dependency info if available
      if (result.dependenciesInstalled && result.dependenciesInstalled.length > 0) {
        response.dependenciesInstalled = result.dependenciesInstalled;
        const successCount = result.dependenciesInstalled.filter(d => d.success).length;
        response.message = `Skill '${result.skill}' installed successfully. ${result.filesInstalled} files copied, ${successCount}/${result.dependenciesInstalled.length} packages installed.`;
      }

      if (result.dependenciesFailed && result.dependenciesFailed > 0) {
        response.dependenciesFailed = result.dependenciesFailed;
      }

      // Include skill dependencies (from skill-deps) if available
      if (result.skillDependenciesInstalled && result.skillDependenciesInstalled.length > 0) {
        response.skillDependenciesInstalled = result.skillDependenciesInstalled;
      }

      // Include dependent skill instructions if available
      if (result.dependentInstructions && Object.keys(result.dependentInstructions).length > 0) {
        response.dependentInstructions = result.dependentInstructions;
        const depSkills = Object.keys(result.dependentInstructions).join(', ');
        response.message = `${response.message}\n\nDependent skill instructions loaded: ${depSkills}`;
      }

      return response;
    }

    throw new Error(`Unknown action: ${input.action}`);
  }
);
