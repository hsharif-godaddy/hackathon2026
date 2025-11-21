import type { AgentExecutionContext } from '../base/agent.interface.js';
import { DirectoryListingTool } from '../tools/directory-listing.js';
import { ReadFileTool } from '../tools/read-file.js';
import { appPlanTool } from '../tools/app-plan-tool.js';
import { logger } from '../logging/index.js';
import { appContextEvents } from '../logging/events/index.js';
import { SecretsManagementTool } from '../tools/secrets-management-tool.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';

/**
 * Service for managing app context information that should be injected into LLM conversations
 * Provides comprehensive project context including:
 * - Directory structure (max depth 3, up to 100 lines)
 * - Package.json information (up to 50 main dependencies, scripts, project details)
 * - Dependency installation status (checks package-lock.json vs package.json timestamps with 5s tolerance for WSL2)
 */
export class AppContextManager {
  private directoryTool: DirectoryListingTool;
  private readFileTool: ReadFileTool;

  constructor() {
    this.directoryTool = new DirectoryListingTool();
    this.readFileTool = new ReadFileTool();
  }

  /**
   * Generate context message that provides directory listing and package information to the LLM
   * @param context - The agent execution context containing app metadata
   * @returns Promise<string | null> - Formatted context message or null if no context needed
   */
  async generateContextMessage(context: AgentExecutionContext): Promise<string | null> {
    const appId = context.metadata?.appId as string;
    const appPath = context.metadata?.appPath as string;

    try {
      // Only generate context if we have an app context
      if (!appId || !appPath) {
        return null;
      }

      appContextEvents.generateBegin(logger, { appId, directoryPath: appPath });

      // Get directory listing with max depth of 3
      const directoryResult = await this.directoryTool.listDirectory(appPath, {
        path: '',
        maxDepth: 4,
        showHidden: false,
        directoriesOnly: false
      });

      if (!directoryResult) {
        appContextEvents.directoryFailure(logger, new Error('Directory listing returned null/undefined'), {
          appId,
          path: appPath,
          maxDepth: 4
        });
        return null;
      }

      // Format the directory result as a tree string
      const directoryListing = this.directoryTool.formatAsTree(directoryResult);

      if (!directoryListing || typeof directoryListing !== 'string') {
        appContextEvents.directoryFailure(logger, new Error(`Directory tree formatting failed - type: ${typeof directoryListing}, length: ${directoryListing?.length || 0}`), {
          appId,
          path: appPath,
          maxDepth: 4
        });
        return null;
      }

      // Get package.json information
      const packageInfo = await this.getPackageInfo(context);

      // Get color scheme information
      const colorSchemeInfo = await this.getColorSchemeInfo(appId);

      // Get secrets information
      const secretsInfo = await this.getSecretsInfo(appId);

      // Format directory listing and package info into context message
      const formattedContext = this.formatAppContext(directoryListing, packageInfo, colorSchemeInfo, secretsInfo);

      // Log successful generation
      const generateData: any = {
        appId,
        directoryPath: appPath,
        fileCount: directoryResult.fileCount,
        directoryCount: directoryResult.directoryCount,
        dependencyCount: (packageInfo?.dependencies.length || 0) + (packageInfo?.devDependencies.length || 0),
        scriptCount: packageInfo?.scripts.length || 0,
        contextSize: formattedContext.length
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

      return formattedContext;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      appContextEvents.generateFailure(logger, err, { appId, directoryPath: appPath });
      return null;
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
    let packageContent: unknown = null;

    if (!appPath || !appId) {
      return null;
    }

    appContextEvents.packageBegin(logger, { appId });

    try {
      // Try to read package.json using the read_file tool
      const readResult = await this.readFileTool.readFile({ path: 'package.json' }, appPath);
      packageContent = readResult.success ? readResult.content : null;

      if (!packageContent || typeof packageContent !== 'string') {
        appContextEvents.packageFailure(logger, new Error(`package.json read returned unexpected type: ${typeof packageContent}`), {
          appId,
          packageJsonFound: false
        });
        return null;
      }

      // The ReadFileTool returns the raw JSON content directly (no headers)
      const jsonContent = packageContent.trim();

      if (!jsonContent) {
        appContextEvents.packageFailure(logger, new Error('No JSON content found in package.json'), {
          appId,
          packageJsonFound: true
        });
        return null;
      }

      const packageJson = JSON.parse(jsonContent);

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
      appContextEvents.packageFailure(logger, err, {
        appId,
        packageJsonFound: typeof packageContent === 'string'
      });
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
   * Format directory listing and package info into a comprehensive context message
   * @param directoryListing - Raw directory listing output
   * @param packageInfo - Package information from package.json
   * @param colorSchemeInfo - Color scheme information from app plan
   * @param secretsInfo - Secrets information from secrets management
   * @returns Formatted context message
   */
  private formatAppContext(directoryListing: string, packageInfo: any, colorSchemeInfo: any, secretsInfo: any): string {
    const directorySection = this.formatDirectorySection(directoryListing);
    const packageSection = this.formatPackageSection(packageInfo);
    const colorSchemeSection = this.formatColorSchemeSection(colorSchemeInfo);
    const secretsSection = this.formatSecretsSection(secretsInfo);

    return `[Current Project Context]

${packageSection}

${colorSchemeSection}

${secretsSection}

${directorySection}

Note: This is the current project context including dependencies, color scheme, secrets, and directory structure. You don't need to run additional directory listings unless you need to explore specific subdirectories in detail.`;
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
   * @returns Formatted secrets section
   */
  private formatSecretsSection(secretsInfo: string[] | null): string {
    const timestamp = new Date().toISOString();
    let secretsContext = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    secretsContext += `🔐 LIVE SECRETS STATE - REFRESHED ON THIS MESSAGE (${timestamp})\n`;
    secretsContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    secretsContext += "⚠️  IMPORTANT: This list is regenerated fresh on EVERY message you receive.\n";
    secretsContext += "⚠️  This is NOT a snapshot from session start - it's the CURRENT state RIGHT NOW.\n";
    secretsContext += "⚠️  If a secret was mentioned earlier but is not in this list, it has been DELETED.\n";
    secretsContext += "⚠️  ONLY use secrets that appear in THIS list - ignore any from conversation history.\n\n";

    if (!secretsInfo || secretsInfo.length === 0) {
      secretsContext += "❌ NO SECRETS CURRENTLY CONFIGURED\n";
      secretsContext += "   The user has not added any secrets yet, or all secrets have been deleted.\n";
    } else {
      secretsContext += `✅ CURRENTLY CONFIGURED SECRETS: ${secretsInfo.length}\n`;
      const secretsList = secretsInfo.map((name, index) => `   ${index + 1}. ${name}`).join('\n');
      secretsContext += secretsList + "\n";
      secretsContext += "\n📝 How to use these secrets in backend code:" +
      "\n   import { getSecret } from '../../../dev-tools/src/secrets-utils.js';" +
      "\n   const value = getSecret('SECRET_NAME');\n";
    }

    secretsContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    return secretsContext;
  }

  /**
   * Format directory listing into a compact section
   * @param directoryListing - Raw directory listing output
   * @returns Formatted directory section
   */
  private formatDirectorySection(directoryListing: string): string {
    // Clean up the directory listing - remove excessive whitespace and format for compactness
    const lines = directoryListing.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    // Find the actual tree structure (skip any headers)
    const treeStartIndex = lines.findIndex(line => line.includes('├') || line.includes('└') || line.includes('│'));
    const treeLines = treeStartIndex >= 0 ? lines.slice(treeStartIndex) : lines;

    // Limit to reasonable number of lines for context
    const maxLines = 200;
    const limitedLines = treeLines.slice(0, maxLines);
    const truncated = treeLines.length > maxLines;

    const compactListing = limitedLines.join('\n');

    return `Directory Structure:
${compactListing}${truncated ? '\n... (truncated for brevity)' : ''}`;
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
