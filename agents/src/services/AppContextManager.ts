import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import type { AgentExecutionContext } from '../base/agent.interface.js';
import { DirectoryListingTool } from '../tools/directory-listing.js';
import { appPlanTool } from '../tools/app-plan-tool.js';
import { logger } from '../logging/index.js';
import { appContextEvents } from '../logging/events/index.js';
import { SecretsManagementTool } from '../tools/secrets-management-tool.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import { mediaManifestService, type MediaSlot } from './MediaManifestService.js';

/**
 * Result of app context generation, split into stable and dynamic parts for cache efficiency
 */
export interface AppContextResult {
  /** Stable context (package info, color scheme) - placed after_history to avoid cache invalidation on file edits */
  stableContext: string | null;
  /** Dynamic secrets context - goes after history to prevent cache invalidation */
  secretsContext: string | null;
  /** Semi-dynamic media slots context - goes after history to prevent cache invalidation */
  mediaSlotsContext: string | null;
}

/**
 * Service for managing app context information that should be injected into LLM conversations
 * Provides comprehensive project context including:
 * - Package.json information (up to 50 main dependencies, scripts, project details)
 * - Dependency installation status (checks package-lock.json vs package.json timestamps with 5s tolerance for WSL2)
 * - Color scheme information
 * - Secrets and media slots
 */
export class AppContextManager {
  private directoryTool: DirectoryListingTool;

  constructor() {
    this.directoryTool = new DirectoryListingTool();
  }

  /**
   * Generate context message that provides package information and color scheme to the LLM
   * @param context - The agent execution context containing app metadata
   * @returns Promise<AppContextResult> - Formatted context messages split by cache stability
   */
  async generateContextMessage(context: AgentExecutionContext): Promise<AppContextResult> {
    const appId = context.metadata?.appId as string;
    const appPath = context.metadata?.appPath as string;

    try {
      // Only generate context if we have an app context
      if (!appId || !appPath) {
        return { stableContext: null, secretsContext: null, mediaSlotsContext: null };
      }

      appContextEvents.generateBegin(logger, { appId, directoryPath: appPath });

      // Fetch all context data in parallel (these are independent lookups)
      // Note: Directory listing removed to prevent cache invalidation on file changes.
      // Agents should use the directoryListing tool when they need to explore the file structure.
      const [packageInfo, colorSchemeInfo, secretsInfo, mediaSlotsInfo] = await Promise.all([
        this.getPackageInfo(context),
        this.getColorSchemeInfo(appId),
        this.getSecretsInfo(appId),
        this.getMediaSlotsInfo(appId),
      ]);

      // Format stable context (package info, color scheme) - after_history to avoid cache invalidation
      const stableContext = this.formatStableContext(packageInfo, colorSchemeInfo);

      // Format dynamic contexts (secrets, media slots) - after_history to prevent cache invalidation
      // These methods return null when there's no content, avoiding boilerplate
      const secretsContext = this.formatSecretsSection(secretsInfo);
      const mediaSlotsContext = this.formatMediaSlotsSection(mediaSlotsInfo);

      // Log successful generation
      const generateData: any = {
        appId,
        directoryPath: appPath,
        dependencyCount: (packageInfo?.dependencies.length || 0) + (packageInfo?.devDependencies.length || 0),
        scriptCount: packageInfo?.scripts.length || 0,
        stableContextSize: stableContext?.length || 0,
        secretsContextSize: secretsContext?.length || 0,
        mediaSlotsContextSize: mediaSlotsContext?.length || 0
      };

      if (packageInfo?.name) {
        generateData.packageName = packageInfo.name;
      }
      if (packageInfo?.version) {
        generateData.packageVersion = packageInfo.version;
      }
      if (packageInfo?.dependenciesInstalled !== undefined) {
        generateData.dependenciesInstalled = packageInfo.dependenciesInstalled;
      }

      appContextEvents.generateSuccess(logger, generateData);

      return {
        stableContext,
        secretsContext,
        mediaSlotsContext
      };

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      appContextEvents.generateFailure(logger, err, { appId, directoryPath: appPath });
      return { stableContext: null, secretsContext: null, mediaSlotsContext: null };
    }
  }

  /**
   * Get package.json information including dependencies and installation status
   * @param context - The agent execution context
   * @returns Promise with package information or null if not available
   */
  private async getPackageInfo(context: AgentExecutionContext): Promise<{
    name?: string;
    version?: string;
    description?: string;
    dependencies: string[];
    devDependencies: string[];
    scripts: string[];
    dependenciesInstalled: boolean;
  } | null> {
    const appId = context.metadata?.appId as string;
    const appPath = context.metadata?.appPath as string;

    if (!appPath || !appId) {
      return null;
    }

    appContextEvents.packageBegin(logger, { appId });

    try {
      const packageJsonPath = resolve(join(appPath, 'package.json'));
      const packageContent = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);

      // Check if dependencies are installed by comparing lock file modification time
      const dependenciesInstalled = await this.checkDependenciesInstalled(context);

      const result = {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        dependencies: Object.keys(packageJson.dependencies || {}),
        devDependencies: Object.keys(packageJson.devDependencies || {}),
        scripts: Object.keys(packageJson.scripts || {}),
        dependenciesInstalled
      };

      appContextEvents.packageSuccess(logger, {
        appId,
        packageJsonFound: true,
        packageName: result.name,
        packageVersion: result.version,
        dependencyCount: result.dependencies.length,
        devDependencyCount: result.devDependencies.length,
        scriptCount: result.scripts.length,
        dependenciesInstalled: result.dependenciesInstalled,
        installationCheckMethod: 'timestamps'
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      appContextEvents.packageFailure(logger, err, { appId, packageJsonFound: false });
      return null;
    }
  }

  /**
   * Check if dependencies are installed by comparing package-lock.json and package.json modification times
   * Uses a 5-second tolerance window to account for WSL2 time inconsistencies
   * @param context - The agent execution context
   * @returns Promise<boolean> - true if dependencies appear to be installed
   */
  private async checkDependenciesInstalled(context: AgentExecutionContext): Promise<boolean> {
    try {
      // Get app path from context
      const appPath = context.metadata?.appPath as string;
      if (!appPath) {
        return false;
      }

      // Get file stats for both package.json and package-lock.json using directory listing
      const listing = await this.directoryTool.listDirectory(appPath, {
        path: '',
        maxDepth: 1,
        showHidden: false,
        directoriesOnly: false
      });

      if (!listing || typeof listing !== 'string') {
        return false;
      }

      // Look for modification times in the directory listing
      // The directory listing should show file modification times
      const listingStr = listing as string;
      const packageJsonMatch = listingStr.match(/package\.json.*?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
      const packageLockMatch = listingStr.match(/package-lock\.json.*?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);

      if (!packageJsonMatch || !packageLockMatch) {
        // If we can't find both files with timestamps, assume not installed
        return false;
      }

      const packageJsonTime = new Date(packageJsonMatch[1]!);
      const packageLockTime = new Date(packageLockMatch[1]!);

      // Calculate time difference in seconds
      const timeDiffSeconds = Math.abs(packageLockTime.getTime() - packageJsonTime.getTime()) / 1000;

      // If package-lock.json is newer than package.json OR within 5 seconds (for WSL2 time inconsistencies)
      // consider dependencies installed
      const isInstalled = packageLockTime >= packageJsonTime || timeDiffSeconds <= 5;

      logger.debug('app.context.dependencies.check', {
        appId: context.metadata?.appId as string,
        packageJsonTime: packageJsonTime.toISOString(),
        packageLockTime: packageLockTime.toISOString(),
        timeDifferenceSeconds: Number(timeDiffSeconds.toFixed(2)),
        dependenciesInstalled: isInstalled,
        toleranceSeconds: 5
      });

      return isInstalled;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn('app.context.dependencies.check.failure', {
        appId: context.metadata?.appId as string,
        error: err.message,
        reason: 'Failed to check dependency installation status'
      });
      return false;
    }
  }

  /**
   * Get color scheme information for the app
   * @param appId - The app ID
   * @returns Color scheme information or null
   */
  private async getColorSchemeInfo(appId: string): Promise<any> {
    try {
      const result = await appPlanTool.execute({
        appId,
        operation: 'get'
      });

      if (result.success && result.data?.colorPalette) {
        return result.data.colorPalette;
      }
      return null;
    } catch (error) {
      logger.warn('app.context.color_scheme.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get secrets information for the app
   * @param appId - The app ID
   * @returns Secrets information or null
   */
  private async getSecretsInfo(appId: string): Promise<any> {
    try {
      // Create dev-supervisor client for the app
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor) {
        return null;
      }

      const secretsTool = new SecretsManagementTool(devSupervisor);
      const result = await secretsTool.listSecretNames(appId);

      if (result.success && result.secretNames.length > 0) {
        return result.secretNames;
      }
      return null;
    } catch (error) {
      logger.warn('app.context.secrets.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get media slots information for the app
   * Returns a map of slot names to their media type for context
   * @param appId - The app ID
   * @returns Map of slot names to media types, or null if no slots
   */
  private async getMediaSlotsInfo(appId: string): Promise<Map<string, string> | null> {
    try {
      const result = await mediaManifestService.getManifest(appId);

      if (!result.success || !result.manifest) {
        return null;
      }

      const slots = Object.entries(result.manifest);
      if (slots.length === 0) {
        return null;
      }

      // Return a map of slot name to media type
      const slotMap = new Map<string, string>();
      for (const [slotName, slot] of slots) {
        slotMap.set(slotName, (slot as MediaSlot).mediaType || 'image');
      }

      logger.debug('app.context.media_slots.success', {
        appId,
        slotCount: slotMap.size
      });

      return slotMap;
    } catch (error) {
      logger.warn('app.context.media_slots.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Format stable context (package info, color scheme) that rarely changes
   * Goes in cached prefix to maximize cache hits
   * @param packageInfo - Package information from package.json
   * @param colorSchemeInfo - Color scheme information from app plan
   * @returns Formatted stable context message
   */
  private formatStableContext(
    packageInfo: any,
    colorSchemeInfo: any
  ): string {
    const packageSection = this.formatPackageSection(packageInfo);
    const colorSchemeSection = this.formatColorSchemeSection(colorSchemeInfo);

    return `[Current Project Context]

${packageSection}

${colorSchemeSection}

Note: This is the current project context including dependencies and color scheme. Use the directoryListing tool to explore the file structure when you need to see what files exist or find specific files. Secrets and media slots may be provided separately if configured.`;
  }

  /**
   * Format color scheme information into a compact section
   * @param colorSchemeInfo - Color scheme information or null
   * @returns Formatted color scheme section
   */
  private formatColorSchemeSection(colorSchemeInfo: any): string {
    if (!colorSchemeInfo) {
      return 'Color Scheme: Not configured';
    }

    const parts = [];

    if (colorSchemeInfo.name) {
      parts.push(`Name: ${colorSchemeInfo.name}`);
    }

    if (colorSchemeInfo.primary) {
      parts.push(`Primary: ${colorSchemeInfo.primary}`);
    }

    if (colorSchemeInfo.secondary) {
      parts.push(`Secondary: ${colorSchemeInfo.secondary}`);
    }

    if (colorSchemeInfo.accent) {
      parts.push(`Accent: ${colorSchemeInfo.accent}`);
    }

    return `Color Scheme: ${parts.join(', ')}`;
  }

  /**
   * Format secrets information into a compact section
   * @param secretsInfo - Array of secret names or null
   * @returns Formatted secrets section, or null if no secrets
   */
  private formatSecretsSection(secretsInfo: string[] | null): string | null {
    // Return null when there are no secrets to avoid sending boilerplate
    if (!secretsInfo || secretsInfo.length === 0) {
      return null;
    }

    const timestamp = new Date().toISOString();
    let secretsContext = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    secretsContext += `🔐 LIVE SECRETS STATE - REFRESHED ON THIS MESSAGE (${timestamp})\n`;
    secretsContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    secretsContext += "⚠️  IMPORTANT: This list is regenerated fresh on EVERY message you receive.\n";
    secretsContext += "⚠️  This is NOT a snapshot from session start - it's the CURRENT state RIGHT NOW.\n";
    secretsContext += "⚠️  If a secret was mentioned earlier but is not in this list, it has been DELETED.\n";
    secretsContext += "⚠️  ONLY use secrets that appear in THIS list - ignore any from conversation history.\n\n";

    secretsContext += `✅ CURRENTLY CONFIGURED SECRETS: ${secretsInfo.length}\n`;
    const secretsList = secretsInfo.map((name, index) => `   ${index + 1}. ${name}`).join('\n');
    secretsContext += secretsList + "\n";
    secretsContext += "\n📝 How to use these secrets in backend code:" +
    "\n   import { getSecret } from '#airo/secrets';" +
    "\n   const value = getSecret('SECRET_NAME');\n";

    secretsContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    return secretsContext;
  }

  /**
   * Format media slots information into a compact section
   * Lists existing slots so the agent knows what's already configured
   * @param mediaSlotsInfo - Map of slot names to media types, or null
   * @returns Formatted media slots section, or null if no slots
   */
  private formatMediaSlotsSection(mediaSlotsInfo: Map<string, string> | null): string | null {
    // Return null when there are no media slots to avoid sending boilerplate
    if (!mediaSlotsInfo || mediaSlotsInfo.size === 0) {
      return null;
    }

    let slotsContext = `\n[Media Slots]\n`;
    slotsContext += "When changing images/videos, UPDATE existing slots - don't create new ones.\n\n";
    slotsContext += `Existing slots (${mediaSlotsInfo.size}):\n`;

    // Sort slots alphabetically for stable, scannable output
    const sortedSlots = Array.from(mediaSlotsInfo.entries()).sort(
      ([aName], [bName]) => aName.localeCompare(bName)
    );
    for (const [slotName, mediaType] of sortedSlots) {
      slotsContext += `  - ${slotName} (${mediaType})\n`;
    }

    return slotsContext;
  }


  /**
   * Format package.json information into a compact section
   * @param packageInfo - Package information or null
   * @returns Formatted package section
   */
  private formatPackageSection(packageInfo: any): string {
    if (!packageInfo) {
      return 'Package Information: Not available';
    }

    const sections = [];

    // Basic project info
    if (packageInfo.name || packageInfo.version || packageInfo.description) {
      const basicInfo = [];
      if (packageInfo.name) basicInfo.push(`Name: ${packageInfo.name}`);
      if (packageInfo.version) basicInfo.push(`Version: ${packageInfo.version}`);
      if (packageInfo.description) basicInfo.push(`Description: ${packageInfo.description}`);
      sections.push(`Project: ${basicInfo.join(', ')}`);
    }

    // Dependencies (up to 50 main dependencies)
    if (packageInfo.dependencies && packageInfo.dependencies.length > 0) {
      const deps = packageInfo.dependencies.slice(0, 50); // Limit to first 50
      const truncated = packageInfo.dependencies.length > 50;
      sections.push(`Dependencies: ${deps.join(', ')}${truncated ? ` (+${packageInfo.dependencies.length - 50} more)` : ''}`);
    }

    // Dev Dependencies (up to 50 dev dependencies)
    if (packageInfo.devDependencies && packageInfo.devDependencies.length > 0) {
      const devDeps = packageInfo.devDependencies.slice(0, 50); // Limit to first 50
      const truncated = packageInfo.devDependencies.length > 50;
      sections.push(`Dev Dependencies: ${devDeps.join(', ')}${truncated ? ` (+${packageInfo.devDependencies.length - 50} more)` : ''}`);
    }

    // Installation status - provide the notice you requested
    if (typeof packageInfo.dependenciesInstalled === 'boolean') {
      sections.push(`Installation Status: ${packageInfo.dependenciesInstalled ? 'Node modules are up to date - you don\'t need to install anything else' : 'Dependencies may need installation'}`);
    }

    // Available scripts
    if (packageInfo.scripts && packageInfo.scripts.length > 0) {
      sections.push(`Scripts: ${packageInfo.scripts.join(', ')}`);
    }

    return sections.length > 0 ? sections.join('\n') : 'Package Information: No details available';
  }
}

const appContextManager = new AppContextManager();

export function getAppContextManager(): AppContextManager {
  return appContextManager;
}
