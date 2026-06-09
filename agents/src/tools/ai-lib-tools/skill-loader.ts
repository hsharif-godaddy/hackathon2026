import { createTool, type Tool, type AgentContext } from '@airo/ai-lib';
import { z } from 'zod';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { appliedSkillsRegistry } from '../applied-skills-registry.js';
import { logger } from '../../logging/index.js';
import { SkillLoaderTool } from '../skill-loader-tool.js';
import { skillToolManager } from '../skill-tool-manager.js';

/**
 * Unified Skill Management Tool for AI-Lib
 *
 * Provides three actions for managing skills:
 * - list: Show all available skills with descriptions from YAML frontmatter
 * - load: Load skill instructions into context (without templates)
 * - install: Directly copy skill template files to app directory
 */
export const skillAITool: Tool = createTool(
  'Manage skills - list, load, unload, pin, unpin, or install. Skills provide specialized knowledge and tools. Pinning keeps a skill loaded for the entire conversation and injects its instructions into every turn (used for mode-style skills like deep-build).',
  z.object({
    action: z.enum(['list', 'load', 'unload', 'pin', 'unpin', 'install']).describe('Action to perform'),
    skill: z.string().optional().describe('Skill name (required for load, unload, pin, unpin, install)'),
  }),
  async (input, context?: AgentContext) => {
    const skillLoader = new SkillLoaderTool();
    const appRepo = new AppRepository();
    const market = typeof context?.metadata?.market === 'string' ? context.metadata.market : undefined;

    // List action - show all available skills
    if (input.action === 'list') {
      const conversationId = context?.metadata?.conversationId as string | undefined;
      const pinned = conversationId
        ? new Set(skillToolManager.getPinnedSkills(conversationId))
        : undefined;
      const contextMetadata = context?.metadata as Record<string, unknown> | undefined;
      const result = await skillLoader.listSkills({ pinned, market, contextMetadata });

      if (!result.success) {
        throw new Error(result.error || 'Failed to list skills');
      }

      return {
        skills: result.skills,
        count: result.skills?.length ?? 0,
        message: `Found ${result.skills?.length ?? 0} available skills. Review descriptions to find the right skill for your task.`
      };
    }

    // Load and install actions require skill name
    if (!input.skill) {
      throw new Error(`Skill name is required for action "${input.action}"`);
    }

    // Load action - load instructions AND activate skill tools
    if (input.action === 'load') {
      if (input.skill === 'marketing-campaigns' && !context?.metadata?.marketingCampaignsEnabled) {
        return {
          success: false,
          error: "Marketing campaigns feature is not enabled for this account. Tell the user this feature isn't available yet and do NOT attempt to create a campaign manually. Stop here.",
        };
      }

      const contextMetadata = context?.metadata as Record<string, unknown> | undefined;
      const result = await skillLoader.loadSkill({ skill: input.skill, market, contextMetadata });

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

    if (input.action === 'pin') {
      const conversationId = context?.metadata?.conversationId as string | undefined;
      if (!conversationId) {
        throw new Error('Conversation ID not found in context. Pin action requires conversation context.');
      }
      // Enforce the same market gating loadSkill applies — otherwise a caller
      // outside the allowlisted markets could pin a market-restricted skill
      // even though listSkills hides it from them.
      if (!(await skillLoader.isSkillAvailableInMarket(input.skill, market))) {
        logger.warn('skill.pin.market_restricted', { skill: input.skill, requestMarket: market });
        return {
          success: false,
          skill: input.skill,
          pinned: false,
          message: `Skill '${input.skill}' is not available in your market.`
        };
      }
      const pinAppId = context?.metadata?.appId as string | undefined;
      const pinResult = skillToolManager.pinSkill(conversationId, input.skill, pinAppId);
      if (!pinResult.success) {
        return {
          success: false,
          skill: input.skill,
          pinned: false,
          message: `Failed to pin skill '${input.skill}': ${pinResult.error}`
        };
      }
      return {
        success: true,
        skill: input.skill,
        pinned: true,
        message: `Skill '${input.skill}' is now pinned for this conversation. Its instructions will be included on every turn until it is unpinned.`
      };
    }

    if (input.action === 'unpin') {
      const conversationId = context?.metadata?.conversationId as string | undefined;
      if (!conversationId) {
        throw new Error('Conversation ID not found in context. Unpin action requires conversation context.');
      }
      const unpinAppId = context?.metadata?.appId as string | undefined;
      skillToolManager.unpinSkill(conversationId, input.skill, unpinAppId);
      return {
        success: true,
        skill: input.skill,
        pinned: false,
        message: `Skill '${input.skill}' has been unpinned.`
      };
    }

    // NEW: Unload action - manually remove skill tools
    if (input.action === 'unload') {
      const conversationId = context?.metadata?.conversationId as string | undefined;

      if (!conversationId) {
        throw new Error('Conversation ID not found in context. Unload action requires conversation context.');
      }

      if (skillToolManager.isPinned(conversationId, input.skill)) {
        return {
          success: false,
          skill: input.skill,
          message: `Skill '${input.skill}' is pinned and cannot be unloaded. Call action 'unpin' first.`
        };
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

      // Enforce the same market gating loadSkill applies — otherwise a caller
      // outside the allowlisted markets could install a market-restricted
      // skill (e.g. region-specific legal templates) even though listSkills
      // hides it from them.
      if (!(await skillLoader.isSkillAvailableInMarket(input.skill, market))) {
        logger.warn('skill.install.market_restricted', { skill: input.skill, requestMarket: market });
        throw new Error(`Skill '${input.skill}' is not available in your market.`);
      }

      // Look up app path
      const app = appRepo.findById(appId);
      if (!app) {
        throw new Error(`App not found: ${appId}`);
      }

      // Install templates directly. Skill dependencies (recursed internally) inherit
      // the parent skill's market grant — no per-dep re-check needed since deps are
      // bundled with the skill and share its market restriction.
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

      // Auto-restart dev server if npm dependencies were installed.
      // Vite needs a restart to resolve newly installed packages —
      // without this, imports like 'better-auth/react' fail until manual restart.
      const depsInstalled = result.dependenciesInstalled?.some(d => d.success);
      if (depsInstalled) {
        try {
          const { ServerManagementTool } = await import('../../tools/server-management-tool.js');
          const serverTool = new ServerManagementTool();
          const restartResult = await serverTool.restartServer({ reason: `skill '${input.skill}' installed new dependencies` }, appId);
          if (restartResult.success) {
            logger.info('skill.install.server-restarted', { skill: input.skill, appId });
          } else {
            logger.warn('skill.install.server-restart-failed', { skill: input.skill, appId, error: restartResult.error });
          }
        } catch (error) {
          // Non-fatal — agent can restart manually if needed
          logger.warn('skill.install.server-restart-failed', {
            skill: input.skill,
            appId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Build response with dependency info
      const skippedNote = result.filesSkipped ? `, ${result.filesSkipped} existing files skipped` : '';
      const response: Record<string, unknown> = {
        skill: result.skill,
        filesInstalled: result.filesInstalled,
        installedFiles: result.installedFiles,
        ...(result.filesSkipped && { filesSkipped: result.filesSkipped }),
        message: `Skill '${result.skill}' installed successfully. ${result.filesInstalled} files copied to ${app.path}${skippedNote}`
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

      if (result.devDependenciesInstalled && result.devDependenciesInstalled.length > 0) {
        response.devDependenciesInstalled = result.devDependenciesInstalled;
        const devSuccessCount = result.devDependenciesInstalled.filter(d => d.success).length;
        // Only append to the prod-deps message when prod deps existed (otherwise
        // the base "files copied to /path" message dangles awkwardly). For the
        // devDeps-only case, replace the base message with the deps-style format
        // the prod branch uses, mirroring its shape.
        if (result.dependenciesInstalled && result.dependenciesInstalled.length > 0) {
          response.message = `${response.message} ${devSuccessCount}/${result.devDependenciesInstalled.length} dev packages installed.`;
        } else {
          response.message = `Skill '${result.skill}' installed successfully. ${result.filesInstalled} files copied, ${devSuccessCount}/${result.devDependenciesInstalled.length} dev packages installed.`;
        }
      }

      if (result.devDependenciesFailed && result.devDependenciesFailed > 0) {
        response.devDependenciesFailed = result.devDependenciesFailed;
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

      // Include post-install notes (critical constraints the agent must follow)
      if (result.postInstallNotes) {
        response.postInstallNotes = result.postInstallNotes;
        response.message = `${response.message}\n\nIMPORTANT: ${result.postInstallNotes}`;
      }

      appliedSkillsRegistry.recordInstall(input.skill, app.path);

      return response;
    }

    throw new Error(`Unknown action: ${input.action}`);
  }
);
