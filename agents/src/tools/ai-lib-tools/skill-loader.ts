import { createTool, type Tool, type AgentContext } from '@airo/ai-lib';
import { z } from 'zod';
import { SkillLoaderTool } from '../skill-loader-tool.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';

/**
 * Unified Skill Management Tool for AI-Lib
 *
 * Provides three actions for managing skills:
 * - list: Show all available skills with descriptions from YAML frontmatter
 * - load: Load skill instructions into context (without templates)
 * - install: Directly copy skill template files to app directory
 */
export const skillAITool: Tool = createTool(
  'Manage skills - list available skills, load skill instructions, or install skill templates. Skills provide specialized knowledge for features like blogs, e-commerce, authentication, etc. Use "list" to discover skills, "load" to get instructions, "install" to copy template files directly to the app.',
  z.object({
    action: z.enum(['list', 'load', 'install']).describe('Action to perform: "list" (show available skills), "load" (get instructions), "install" (copy templates to app)'),
    skill: z.string().optional().describe('Name of the skill (required for "load" and "install" actions)'),
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

    // Load action - return instructions only (no templates)
    if (input.action === 'load') {
      const result = await skillLoader.loadSkill({ skill: input.skill });

      if (!result.success) {
        throw new Error(result.error || 'Failed to load skill');
      }

      return {
        skill: result.skill,
        instructions: result.instructions,
        message: `Skill '${result.skill}' loaded successfully. Follow the instructions to implement the feature.`
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
