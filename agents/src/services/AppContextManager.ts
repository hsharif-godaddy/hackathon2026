import type { AgentExecutionContext } from '../base/agent.interface.js';
import { appPlanTool, type ColorPalette, type FontTheme } from '../tools/app-plan-tool.js';
import { logger } from '../logging/index.js';
import { appContextEvents } from '../logging/events/index.js';
import { SecretsManagementTool } from '../tools/secrets-management-tool.js';
import { mediaManifestService, type MediaSlot } from './MediaManifestService.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { getKvMemoryStore } from '../memory/adapters/index.js';
import type { KvMemoryStore } from '../memory/interfaces/index.js';
import { customerIdFromContext, workspaceScopeFromAppId } from '../memory/interfaces/scope.js';
import { createForWorkspace } from '../workspace/index.js';
import { buildShellCommand } from '../utils/shell-utils.js';
import { isDevSupervisorNotFound } from './DevSupervisorClient.js';

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
  /** Git status context - branch, uncommitted changes, last commit */
  gitStatusContext: string | null;
  /** Publish state context - whether app is published and its URL */
  publishStateContext: string | null;
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
  private appRepository: AppRepository;

  constructor(private kvMemoryStore: KvMemoryStore = getKvMemoryStore()) {
    this.appRepository = new AppRepository();
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
        return { stableContext: null, secretsContext: null, mediaSlotsContext: null, gitStatusContext: null, publishStateContext: null };
      }

      appContextEvents.generateBegin(logger, { appId, directoryPath: appPath });

      // Fetch all context data in parallel (these are independent lookups)
      // Note: Directory listing removed to prevent cache invalidation on file changes.
      // Agents should use the directoryListing tool when they need to explore the file structure.
      const customerId = customerIdFromContext(context);
      const [packageInfo, designSystemInfo, secretsInfo, mediaSlotsInfo, gitStatusInfo, publishStateInfo] = await Promise.all([
        this.getPackageInfo(context),
        this.getDesignSystemInfo(appId, customerId),
        this.getSecretsInfo(appId),
        this.getMediaSlotsInfo(appId),
        this.getGitStatusInfo(appId),
        this.getPublishStateInfo(appId),
      ]);

      // Format stable context (package info, design system) - after_history to avoid cache invalidation
      const stableContext = this.formatStableContext(packageInfo, designSystemInfo);

      // Format dynamic contexts (secrets, media slots) - after_history to prevent cache invalidation
      // These methods return null when there's no content, avoiding boilerplate
      const secretsContext = this.formatSecretsSection(secretsInfo);
      const mediaSlotsContext = this.formatMediaSlotsSection(mediaSlotsInfo);
      const gitStatusContext = this.formatGitStatusSection(gitStatusInfo);
      const publishStateContext = this.formatPublishStateSection(publishStateInfo);

      // Log successful generation
      const generateData: any = {
        appId,
        directoryPath: appPath,
        dependencyCount: (packageInfo?.dependencies.length || 0) + (packageInfo?.devDependencies.length || 0),
        scriptCount: packageInfo?.scripts.length || 0,
        stableContextSize: stableContext?.length || 0,
        secretsContextSize: secretsContext?.length || 0,
        mediaSlotsContextSize: mediaSlotsContext?.length || 0,
        gitStatusContextSize: gitStatusContext?.length || 0,
        publishStateContextSize: publishStateContext?.length || 0
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
        mediaSlotsContext,
        gitStatusContext,
        publishStateContext
      };

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      appContextEvents.generateFailure(logger, err, { appId, directoryPath: appPath });
      return { stableContext: null, secretsContext: null, mediaSlotsContext: null, gitStatusContext: null, publishStateContext: null };
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

    if (!appId) {
      return null;
    }

    appContextEvents.packageBegin(logger, { appId });

    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) return null;

    let packageJson: Record<string, unknown>;
    let viewedContent: string | null = null;
    try {
      const viewResult = await workspace.files.view({ path: 'package.json', limit: 10000 });
      viewedContent = viewResult.content;
      packageJson = JSON.parse(viewResult.content);
    } catch (error) {
      // No package.json yet (e.g. fresh template) is a legitimate "no info"
      // signal — return null. Anything else (transport, parse error)
      // propagates so the outer context-generation path fails loudly.
      if (isDevSupervisorNotFound(error)) {
        appContextEvents.packageFailure(logger, error as Error, { appId, packageJsonFound: false });
        return null;
      }
      // Parse failures are recoverable in principle but indicate template corruption;
      // emit a high-signal log with a content snippet so the cause is visible without
      // grepping for the generic generateFailure event.
      if (error instanceof SyntaxError && viewedContent !== null) {
        logger.error('app.context.package.parse.failure', {
          appId,
          parseError: error.message,
          contentSnippet: viewedContent.slice(0, 200),
        });
      }
      throw error;
    }

    const dependenciesInstalled = await this.checkDependenciesInstalled(context);

    const result = {
      name: packageJson.name as string | undefined,
      version: packageJson.version as string | undefined,
      description: packageJson.description as string | undefined,
      dependencies: Object.keys((packageJson.dependencies as Record<string, string> | undefined) || {}),
      devDependencies: Object.keys((packageJson.devDependencies as Record<string, string> | undefined) || {}),
      scripts: Object.keys((packageJson.scripts as Record<string, string> | undefined) || {}),
      dependenciesInstalled,
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
  }

  /**
   * Check if dependencies are installed by comparing package-lock.json and package.json modification times
   * Uses a 5-second tolerance window to account for WSL2 time inconsistencies
   * @param context - The agent execution context
   * @returns Promise<boolean> - true if dependencies appear to be installed
   */
  private async checkDependenciesInstalled(context: AgentExecutionContext): Promise<boolean> {
    const appId = context.metadata?.appId as string;
    if (!appId) return false;

    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) return false;

    let entries;
    try {
      const result = await workspace.files.tree({
        recursive: false,
        includeGlobs: ['package.json', 'package-lock.json'],
      });
      entries = result.entries;
    } catch (error) {
      // Missing root means there's nothing to check yet — fresh app, no template.
      // Anything else (transport, etc.) propagates so the outer context-generation
      // path can decide how to surface the failure.
      if (isDevSupervisorNotFound(error)) return false;
      throw error;
    }

    const pkg = entries.find((e) => e.kind === 'file' && e.path === 'package.json');
    const lock = entries.find((e) => e.kind === 'file' && e.path === 'package-lock.json');
    if (!pkg || !lock) return false;

    const pkgTime = new Date(pkg.modifiedAt);
    const lockTime = new Date(lock.modifiedAt);
    // Only the pkg-newer arm needs the tolerance window — when lock >= pkg the diff is non-positive.
    const pkgAheadSeconds = Math.max(0, pkgTime.getTime() - lockTime.getTime()) / 1000;

    // Lockfile newer-or-equal means deps are in sync. Allow a 5s tolerance for WSL2.
    const isInstalled = pkgAheadSeconds <= 5;

    logger.debug('app.context.dependencies.check', {
      appId,
      packageJsonTime: pkgTime.toISOString(),
      packageLockTime: lockTime.toISOString(),
      pkgAheadSeconds: Number(pkgAheadSeconds.toFixed(2)),
      dependenciesInstalled: isInstalled,
      toleranceSeconds: 5,
    });

    return isInstalled;
  }

  /**
   * Get design system information (color palette + font theme) for the app
   * @param appId - The app ID
   * @param customerId - Optional customerId for tenant-scoped lookups
   * @returns Design system info or null
   */
  private async getDesignSystemInfo(appId: string, customerId?: string): Promise<{ colorPalette: ColorPalette | null; fontTheme: FontTheme | null } | null> {
    try {
      const result = await appPlanTool.execute({
        appId,
        operation: 'get'
      });

      if (result.success && (result.data?.colorPalette || result.data?.fontTheme)) {
        return {
          colorPalette: result.data.colorPalette || null,
          fontTheme: result.data.fontTheme || null
        };
      }

      // Fallback: read from memory table (persisted by brand tools)
      const scope = workspaceScopeFromAppId(appId, customerId);
      const [paletteResult, typographyResult] = await Promise.all([
        this.kvMemoryStore.get(scope, 'brand.colors.palette'),
        this.kvMemoryStore.get(scope, 'brand.typography'),
      ]);
      const colorPalette = paletteResult.exists && paletteResult.value
        ? { name: 'Brand Colors', ...(paletteResult.value as Partial<ColorPalette> & { name?: string }) } as ColorPalette
        : null;
      const fontTheme = typographyResult.exists && typographyResult.value
        ? typographyResult.value as FontTheme
        : null;
      if (colorPalette || fontTheme) {
        return { colorPalette, fontTheme };
      }

      return null;
    } catch (error) {
      logger.warn('app.context.designSystem.failure', {
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
    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) return null;

    // Supervisor failures propagate; "no secrets configured yet" is encoded
    // in the result.success / empty list — not via thrown errors.
    const secretsTool = new SecretsManagementTool(workspace.tasks);
    const result = await secretsTool.listSecretNames(appId);

    if (result.success && result.secretNames.length > 0) {
      return result.secretNames;
    }
    return null;
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
   * Format stable context (package info, design system) that rarely changes
   * Goes in cached prefix to maximize cache hits
   * @param packageInfo - Package information from package.json
   * @param designSystemInfo - Design system info (colors + fonts) from app plan
   * @returns Formatted stable context message
   */
  private formatStableContext(
    packageInfo: any,
    designSystemInfo: { colorPalette: ColorPalette | null; fontTheme: FontTheme | null } | null
  ): string {
    const packageSection = this.formatPackageSection(packageInfo);
    const designSystemSection = this.formatDesignSystemSection(designSystemInfo);

    return `[Current Project Context]

${packageSection}

${designSystemSection}

Note: This is the current project context including dependencies and design system. Use the directoryListing tool to explore the file structure when you need to see what files exist or find specific files. Secrets and media slots may be provided separately if configured.`;
  }

  /**
   * Format design system information (colors + fonts) into a compact section
   * @param designInfo - Design system info or null
   * @returns Formatted design system section
   */
  private formatDesignSystemSection(designInfo: { colorPalette: ColorPalette | null; fontTheme: FontTheme | null } | null): string {
    if (!designInfo) {
      return 'Design System: Not configured';
    }

    const sections: string[] = [];

    // Color scheme
    if (designInfo.colorPalette) {
      const parts = [];
      if (designInfo.colorPalette.name) parts.push(`Name: ${designInfo.colorPalette.name}`);
      if (designInfo.colorPalette.primary) parts.push(`Primary: ${designInfo.colorPalette.primary}`);
      if (designInfo.colorPalette.secondary) parts.push(`Secondary: ${designInfo.colorPalette.secondary}`);
      if (designInfo.colorPalette.accent) parts.push(`Accent: ${designInfo.colorPalette.accent}`);
      sections.push(`Color Scheme: ${parts.join(', ')}`);
    } else {
      sections.push('Color Scheme: Not configured');
    }

    // Font theme
    if (designInfo.fontTheme) {
      const fontParts = [];
      if (designInfo.fontTheme.name) fontParts.push(`Theme: ${designInfo.fontTheme.name}`);
      if (designInfo.fontTheme.headerFont?.name) fontParts.push(`Headers: ${designInfo.fontTheme.headerFont.name}`);
      if (designInfo.fontTheme.bodyFont?.name) fontParts.push(`Body: ${designInfo.fontTheme.bodyFont.name}`);
      sections.push(`Font Theme: ${fontParts.join(', ')}`);
    }

    return sections.join('\n');
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
   * Get git status information for the app workspace via dev-supervisor.
   *
   * Returns null only for legitimate "nothing to report" cases (no workspace
   * bound yet, or all git commands exit non-zero — e.g. no commits in a fresh
   * repo). Transport / supervisor failures propagate to the caller — if
   * dev-supervisor is unreachable the agent context cannot be assembled, and
   * silently dropping just the git panel would hide the real problem.
   */
  private async getGitStatusInfo(appId: string): Promise<{
    branch: string | null;
    uncommittedCount: number | null;
    lastCommitHash: string | null;
    lastCommitMessage: string | null;
  } | null> {
    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) return null;

    // workingDir: '/app' is explicit (matches GitTool / SecretsManagementTool).
    // Non-zero exit → null (e.g. no commits yet); rejection (supervisor down)
    // propagates so the outer context-generation path fails loudly.
    const runGit = (args: string[]) =>
      workspace.tasks
        .runCommandSync({
          command: buildShellCommand(['git', ...args]),
          workingDir: '/app',
          timeoutSeconds: 5,
        })
        .then((r) => (r.exitCode === 0 ? r : null));

    const [branchResult, statusResult, logResult] = await Promise.all([
      runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      runGit(['status', '--porcelain']),
      runGit(['log', '-1', '--format=%h %s']),
    ]);

    if (!branchResult && !statusResult && !logResult) {
      return null;
    }

    const uncommittedCount = statusResult
      ? (statusResult.stdout.trim() ? statusResult.stdout.trim().split('\n').length : 0)
      : null;

    let lastCommitHash: string | null = null;
    let lastCommitMessage: string | null = null;
    const logTrimmed = logResult?.stdout.trim() || '';
    if (logTrimmed) {
      const spaceIdx = logTrimmed.indexOf(' ');
      if (spaceIdx === -1) {
        lastCommitHash = logTrimmed;
      } else {
        lastCommitHash = logTrimmed.substring(0, spaceIdx);
        lastCommitMessage = logTrimmed.substring(spaceIdx + 1);
      }
    }

    // Detached HEAD: reuse the short hash from `git log` instead of a 4th call.
    const rawBranch = branchResult?.stdout.trim() || null;
    const branch = rawBranch === 'HEAD'
      ? (lastCommitHash ? `detached:${lastCommitHash}` : null)
      : rawBranch;

    return { branch, uncommittedCount, lastCommitHash, lastCommitMessage };
  }

  /**
   * Format git status information into a compact section
   * @param gitInfo - Git status info or null
   * @returns Formatted git status section, or null if no git repo
   */
  private formatGitStatusSection(gitInfo: {
    branch: string | null;
    uncommittedCount: number | null;
    lastCommitHash: string | null;
    lastCommitMessage: string | null;
  } | null): string | null {
    if (!gitInfo) return null;

    const parts: string[] = ['## Git Status'];
    if (gitInfo.branch) {
      parts.push(`- Branch: ${gitInfo.branch}`);
    }
    if (gitInfo.uncommittedCount !== null) {
      parts.push(`- Uncommitted changes: ${gitInfo.uncommittedCount}`);
    }
    if (gitInfo.lastCommitHash) {
      parts.push(`- Last commit: ${gitInfo.lastCommitHash}${gitInfo.lastCommitMessage ? ` ${gitInfo.lastCommitMessage}` : ''}`);
    }
    return parts.join('\n');
  }

  /**
   * Get publish state information for the app
   * @param appId - The app ID
   * @returns Publish state info or null
   */
  private async getPublishStateInfo(appId: string): Promise<{ publishedUrl: string | null } | null> {
    try {
      const app = this.appRepository.findById(appId);
      if (!app) return null;
      return { publishedUrl: app.publishedUrl || null };
    } catch (error) {
      logger.warn('app.context.publishState.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Format publish state information into a compact section
   * @param publishStateInfo - Publish state info or null
   * @returns Formatted publish state section, or null if no data
   */
  private formatPublishStateSection(publishStateInfo: { publishedUrl: string | null } | null): string | null {
    if (!publishStateInfo) return null;

    const isPublished = !!publishStateInfo.publishedUrl;
    let section = `## App Status\n- Published: ${isPublished ? 'yes' : 'no'}`;
    if (publishStateInfo.publishedUrl) {
      section += `\n- URL: ${publishStateInfo.publishedUrl}`;
    }
    return section;
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
