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
  'Manage skills - list, load, unload, or install. Skills provide specialized knowledge and tools. Use "list" to discover skills, "load" to activate skill instructions and tools (auto-continues to make tools available immediately), "unload" to remove skill tools, "install" to copy templates.',
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

    // Load action - load instructions AND register skill tools
    if (input.action === 'load') {
      const result = await skillLoader.loadSkill({ skill: input.skill });

      if (!result.success) {
        throw new Error(result.error || 'Failed to load skill');
      }

      // NEW: Register skill tools for dynamic loading
      const conversationId = context?.metadata?.conversationId as string | undefined;

      if (conversationId) {
        const currentTokenCount = (context?.metadata?.tokenCount as number) || 0;

        try {
          const toolResult = await skillToolManager.registerSkill(
            input.skill,
            conversationId,
            currentTokenCount,
            context
          );

          if (!toolResult.success) {
            logger.warn('skill.tools.registration_failed', {
              skill: input.skill,
              conversationId,
              error: toolResult.error
            });

            // Return without tools if registration failed
            return {
              skill: result.skill,
              instructions: result.instructions,
              toolsAvailable: [],
              message: `Skill '${result.skill}' loaded with instructions only. Tool registration failed: ${toolResult.error}`
            };
          }

          // Return with auto-continuation flags for seamless UX
          return {
            skill: result.skill,
            instructions: result.instructions,
            toolsAvailable: toolResult.tools,
            message: `Skill '${result.skill}' loaded with ${toolResult.tools.length} tools: ${toolResult.tools.join(', ')}. Follow the instructions to use them.`,

            // AUTO-CONTINUATION FLAGS (critical for single-turn UX)
            __autoContinue: true,
            __continuationPrompt: `Continue with the original task. The ${result.skill} skill tools are now available: ${toolResult.tools.join(', ')}. Use them to complete the user's request.`
          };
        } catch (error) {
          logger.error('skill.tools.registration_error', {
            skill: input.skill,
            conversationId,
            error: error instanceof Error ? error.message : String(error)
          });

          // Return instructions only on error
          return {
            skill: result.skill,
            instructions: result.instructions,
            toolsAvailable: [],
            message: `Skill '${result.skill}' loaded with instructions only. Tool registration encountered an error.`
          };
        }
      }

      // No conversationId - return instructions only
      return {
        skill: result.skill,
        instructions: result.instructions,
        toolsAvailable: [],
        message: `Skill '${result.skill}' loaded with instructions. No conversation context available for tool registration.`
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

      return response;
    }

    throw new Error(`Unknown action: ${input.action}`);
  }
);
