import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { logger } from '../logging/index.js';
import { skills, getFeatures } from '../services/features.js';
import { TerminalTool } from './terminal.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';

/**
 * Options for loading a skill
 */
export interface SkillLoaderOptions {
  /** Name of the skill to load (e.g., 'blog', 'commerce') */
  skill: string;
}

/**
 * Configuration for a skill dependency
 */
export interface SkillDependencyConfig {
  /** Whether to install templates from the dependency skill */
  templates?: boolean;
  /** Whether to include instructions from the dependency skill */
  instructions?: boolean;
  /** Whether to overwrite existing files in the app */
  overwrite?: boolean;
}

/**
 * Options for installing skill templates
 */
export interface InstallTemplatesOptions {
  /** Name of the skill */
  skill: string;
  /** Base directory where app code lives (e.g., '/tmp/apps/abc123/app') */
  appPath: string;
  /** App ID for terminal command execution */
  appId: string;
  /** @internal Set of skills being installed to prevent circular dependencies */
  installingSkills?: Set<string>;
  /** @internal Configuration for this installation (from skill-deps) */
  config?: SkillDependencyConfig;
}

/**
 * Template file contents
 */
export interface TemplateFile {
  /** Relative path from templates/ directory */
  path: string;
  /** File contents */
  content: string;
}

/**
 * Result of loading a skill
 */
export interface SkillLoaderResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Name of the skill */
  skill: string;
  /** Skill instructions (content of skill.md) */
  instructions?: string;
  /** Template files with contents */
  templates?: TemplateFile[];
  /** Error message if operation failed */
  error?: string;
}

/**
 * Result of a single dependency installation attempt
 */
export interface DependencyInstallResult {
  /** Package name */
  package: string;
  /** Whether installation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Number of retries attempted */
  retries: number;
}

/**
 * Result of installing skill templates
 *
 * Note on success semantics: success: true indicates template files were installed.
 * If some npm dependencies fail to install, the operation is still considered successful
 * because the skill templates are usable. Check dependenciesFailed > 0 for partial failures.
 */
export interface InstallTemplatesResult {
  /** Whether template files were installed successfully */
  success: boolean;
  /** Name of the skill */
  skill: string;
  /** Number of files copied */
  filesInstalled?: number;
  /** List of installed file paths */
  installedFiles?: string[];
  /** Number of files skipped because they already exist */
  filesSkipped?: number;
  /** Dependencies installation results */
  dependenciesInstalled?: DependencyInstallResult[];
  /** Number of dependencies that failed to install */
  dependenciesFailed?: number;
  /** True if some dependencies failed but templates succeeded */
  partialSuccess?: boolean;
  /** List of skill dependencies that were installed (from skill-deps) */
  skillDependenciesInstalled?: string[];
  /** Instructions from dependent skills (key: skill name, value: instructions) */
  dependentInstructions?: Record<string, string>;
  /** Post-install notes from skill frontmatter (critical constraints for the agent) */
  postInstallNotes?: string;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Skill list item with metadata from YAML frontmatter
 */
export interface SkillListItem {
  name: string;
  description: string;
  whenToUse?: string;
  enablementId?: string;
}

/**
 * Build the "Available Skills" prompt section from skill metadata.
 * Returns a markdown string with preamble and skill list ready to inject into a system prompt.
 */
export function buildSkillsPromptSection(skills: SkillListItem[]): string {
  const skillsList = skills
    .map(s => {
      const whenToUse = s.whenToUse ? ` *When to use:* ${s.whenToUse}` : '';
      return `- **${s.name}**: ${s.description}${whenToUse}`;
    })
    .join('\n');

  return `## Available Skills

**IMPORTANT: Before implementing any feature, check this list for a matching skill.** Skills provide battle-tested templates, patterns, and specialized tools. If a skill matches the user's request, load it immediately with \`skill({ action: "load", skill: "name" })\` and follow its instructions.

${skillsList}`;
}

/**
 * Tool for dynamically loading skill instructions and templates
 * Skills provide contextual knowledge and code templates that can be loaded on-demand
 */
export class SkillLoaderTool {
  private readonly logger = logger.child({ module: 'SkillLoaderTool' });
  private readonly skillsDir: string;

  constructor() {
    // Get skills directory relative to this file
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    this.skillsDir = path.resolve(currentDir, '..', 'skills');
  }

  /**
   * Validate skill name to prevent directory traversal attacks
   * @private
   */
  private validateSkillName(skillName: string): boolean {
    // Skill names must be alphanumeric, hyphens, or underscores only
    // This prevents directory traversal attacks (../, /, etc.)
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    return validPattern.test(skillName);
  }

  /**
   * Validate npm package name to prevent malicious package installation
   * @see https://docs.npmjs.com/cli/v9/configuring-npm/package-json#name
   * @private
   */
  private validatePackageName(packageName: string): boolean {
    // npm package names: lowercase, hyphens, @scopes allowed
    // Must start with alphanumeric or @scope, can contain . _ - ~
    // Optional version suffix: @1.0.0, @^1.0.0, @~1.0.0, @latest, etc.
    const validPattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-zA-Z0-9.^~<>=|-]+)?$/;
    return validPattern.test(packageName);
  }

  /**
   * Safely construct a path within the skills directory
   * Validates skill name to prevent directory traversal attacks
   * @private
   * @throws Error if skill name is invalid
   */
  private getSkillPath(skillName: string, subpath?: string): string {
    if (!this.validateSkillName(skillName)) {
      throw new Error(`Invalid skill name '${skillName}'. Skill names must contain only letters, numbers, hyphens, and underscores.`);
    }
    if (subpath) {
      return path.join(this.skillsDir, skillName, subpath);
    }
    return path.join(this.skillsDir, skillName);
  }

  /**
   * Load a skill by name
   * Returns the skill instructions (skill.md)
   */
  async loadSkill(options: SkillLoaderOptions): Promise<SkillLoaderResult> {
    const { skill } = options;

    this.logger.info('skill.load.start', {
      skill
    });

    try {
      // Use helper to safely construct paths (validates internally)
      const skillDir = this.getSkillPath(skill);

      // Check if skill directory exists
      try {
        await fs.access(skillDir);
      } catch {
        this.logger.warn('skill.load.not_found', { skill });
        return {
          success: false,
          skill,
          error: `Skill '${skill}' not found. Available skills can be listed using the skill directory.`
        };
      }

      // Load skill.md (instructions) - using helper for safety
      const skillFile = this.getSkillPath(skill, 'skill.md');
      let instructions: string | undefined;
      try {
        instructions = await fs.readFile(skillFile, 'utf-8');
        this.logger.info('skill.load.instructions_loaded', {
          skill,
          size: instructions.length
        });
      } catch (error) {
        this.logger.warn('skill.load.instructions_missing', {
          skill,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      if (!instructions) {
        this.logger.error('skill.load.empty', { skill });
        return {
          success: false,
          skill,
          error: `Skill '${skill}' has no instructions`
        };
      }

      // Load template files if templates directory exists - using helper for safety
      const templatesDir = this.getSkillPath(skill, 'templates');
      let templates: TemplateFile[] = [];
      try {
        await fs.access(templatesDir);
        templates = await this.loadTemplateFiles(templatesDir, '');
        this.logger.info('skill.load.templates_loaded', {
          skill,
          count: templates.length
        });
      } catch (error) {
        this.logger.info('skill.load.no_templates', { skill });
      }

      this.logger.info('skill.load.success', {
        skill,
        hasInstructions: !!instructions,
        templateCount: templates.length
      });

      return {
        success: true,
        skill,
        ...(instructions ? { instructions } : {}),
        ...(templates.length > 0 ? { templates } : {})
      };
    } catch (error) {
      // Handle validation errors and other errors
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Log validation errors as warnings, other errors as errors
      if (errorMessage.includes('Invalid skill name')) {
        this.logger.warn('skill.load.invalid_name', { skill, error: errorMessage });
      } else {
        this.logger.error('skill.load.error', { skill, error: errorMessage });
      }

      return {
        success: false,
        skill,
        error: errorMessage
      };
    }
  }

  /**
   * Install skill templates directly to app directory
   * Copies template files without going through LLM context
   */
  async installTemplates(options: InstallTemplatesOptions): Promise<InstallTemplatesResult> {
    const { skill, appPath, appId, installingSkills = new Set<string>(), config = {} } = options;

    // Prevent circular dependencies
    if (installingSkills.has(skill)) {
      this.logger.warn('skill.install.circular_dependency', { skill });
      return {
        success: true,
        skill,
        filesInstalled: 0,
        installedFiles: []
      };
    }

    installingSkills.add(skill);

    this.logger.info('skill.install.start', {
      skill,
      appPath
    });

    try {
      // Handle skill-deps from frontmatter (install dependencies first)
      const skillFile = this.getSkillPath(skill, 'skill.md');
      const skillContent = await fs.readFile(skillFile, 'utf-8');
      const { data } = matter(skillContent);

      const skillDeps = data['skill-deps'] as Record<string, SkillDependencyConfig> | undefined;
      const installedSkillDeps: string[] = [];
      const dependentInstructions: Record<string, string> = {};

      if (skillDeps) {
        for (const [depSkill, depConfig] of Object.entries(skillDeps)) {
          if (depConfig.templates) {
            this.logger.info('skill.install.dependency', {
              skill,
              dependency: depSkill
            });

            const depResult = await this.installTemplates({
              skill: depSkill,
              appPath,
              appId,
              installingSkills,
              config: depConfig
            });

            installedSkillDeps.push(depSkill);

            // Collect dependent instructions if requested
            if (depConfig.instructions && depResult.success) {
              try {
                const depSkillFile = this.getSkillPath(depSkill, 'skill.md');
                const depInstructions = await fs.readFile(depSkillFile, 'utf-8');

                this.logger.info('skill.install.dependency_instructions_loaded', {
                  skill,
                  dependency: depSkill,
                  size: depInstructions.length
                });

                dependentInstructions[depSkill] = depInstructions;

                // Also collect instructions from recursive dependencies
                if (depResult.dependentInstructions) {
                  Object.assign(dependentInstructions, depResult.dependentInstructions);
                }
              } catch (error) {
                this.logger.warn('skill.install.dependency_instructions_failed', {
                  skill,
                  dependency: depSkill,
                  error: error instanceof Error ? error.message : String(error)
                });
              }
            }
          }
        }
      }

      // Install npm dependencies from skill.md frontmatter (before templates,
      // so skills with only dependencies and no templates still work)
      const dependencyResults = await this.installDependencies(skill, appPath, appId);

      // Use helper to safely construct paths (validates internally)
      const templatesDir = this.getSkillPath(skill, 'templates');

      // Load and install template files if they exist
      const installedFiles: string[] = [];
      let filesSkipped = 0;
      let hasTemplates = false;

      try {
        await fs.access(templatesDir);
        hasTemplates = true;
      } catch {
        this.logger.info('skill.install.no_templates', { skill });
      }

      if (hasTemplates) {
        const templates = await this.loadTemplateFiles(templatesDir, '');

        if (templates.length === 0) {
          this.logger.info('skill.install.empty_templates', { skill });
        }

        // Copy each template file to destination
        for (const template of templates) {
          const destPath = this.getDestinationPath(skill, template.path, appPath);

          try {
            // Skip existing files unless overwrite is explicitly requested
            if (config.overwrite !== true) {
              try {
                await fs.access(destPath);
                this.logger.info('skill.install.skip_existing', {
                  skill,
                  path: destPath
                });
                filesSkipped++;
                continue;
              } catch {
                // File doesn't exist, proceed with install
              }
            }

            // Ensure destination directory exists
            const destDir = path.dirname(destPath);
            await fs.mkdir(destDir, { recursive: true });

            // Write file
            await fs.writeFile(destPath, template.content, 'utf-8');
            installedFiles.push(destPath);

            this.logger.info('skill.install.file_copied', {
              skill,
              from: template.path,
              to: destPath
            });
          } catch (error) {
            this.logger.error('skill.install.file_failed', {
              skill,
              path: template.path,
              destPath,
              error: error instanceof Error ? error.message : String(error)
            });
            // Continue with other files even if one fails
          }
        }
      }
      const failedDeps = dependencyResults.filter(r => !r.success).length;

      this.logger.info('skill.install.success', {
        skill,
        filesInstalled: installedFiles.length,
        filesSkipped,
        dependenciesInstalled: dependencyResults.length,
        dependenciesFailed: failedDeps,
        skillDependenciesInstalled: installedSkillDeps.length
      });

      const result: InstallTemplatesResult = {
        success: true,
        skill,
        filesInstalled: installedFiles.length,
        installedFiles,
        ...(filesSkipped > 0 && { filesSkipped }),
      };

      if (dependencyResults.length > 0) {
        result.dependenciesInstalled = dependencyResults;
      }

      if (failedDeps > 0) {
        result.dependenciesFailed = failedDeps;
        // Indicate partial success: templates installed but some deps failed
        result.partialSuccess = true;
      }

      if (installedSkillDeps.length > 0) {
        result.skillDependenciesInstalled = installedSkillDeps;
      }

      if (Object.keys(dependentInstructions).length > 0) {
        result.dependentInstructions = dependentInstructions;
      }

      // Pass through post-install notes from frontmatter (critical constraints for the agent)
      const postInstallNotes = data['post-install-notes'] as string | undefined;
      if (postInstallNotes) {
        result.postInstallNotes = postInstallNotes;
      }

      return result;
    } catch (error) {
      // Handle validation errors and other errors
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Log validation errors as warnings, other errors as errors
      if (errorMessage.includes('Invalid skill name')) {
        this.logger.warn('skill.install.invalid_name', { skill, error: errorMessage });
      } else {
        this.logger.error('skill.install.error', { skill, error: errorMessage });
      }

      return {
        success: false,
        skill,
        error: errorMessage
      };
    }
  }

  /**
   * Get destination path for a template file
   * Maps template paths to app paths (e.g., components/BlogCard.tsx -> src/components/blog/BlogCard.tsx)
   */
  private getDestinationPath(skill: string, templatePath: string, appPath: string): string {
    // Skill-specific path mapping
    if (skill === 'blog') {
      let destPath = templatePath;

      // Map template directories to app directories
      if (templatePath.startsWith('components/')) {
        destPath = templatePath.replace('components/', 'components/blog/');
      } else if (templatePath.startsWith('content/')) {
        destPath = templatePath.replace('content/', 'content/blog/');
      }

      return path.join(appPath, 'src', destPath);
    }

    // Database skill: drizzle.config.ts goes to app root
    if (skill === 'database' && templatePath === 'drizzle.config.ts') {
      return path.join(appPath, templatePath);
    }

    // Default: copy to src/{templatePath}
    return path.join(appPath, 'src', templatePath);
  }

  /**
   * List all available skills with their descriptions from YAML frontmatter
   * Only reads the frontmatter, not the full skill.md content
   */
  async listSkills(): Promise<{ success: boolean; skills?: SkillListItem[]; error?: string }> {
    this.logger.info('skill.list.start', {});

    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
      const skillDirs = entries.filter(entry => entry.isDirectory());

      // Load metadata from YAML frontmatter in skill.md
      const skillPromises = skillDirs.map(async (entry): Promise<SkillListItem | null> => {
        const skillName = entry.name;
        let name = skillName;
        let description = '';
        let whenToUse: string | undefined;
        let enablementId: string | undefined;

        try {
          const skillFile = this.getSkillPath(skillName, 'skill.md');
          const skillContent = await fs.readFile(skillFile, 'utf-8');
          const { data } = matter(skillContent);

          // Extract name, description, whenToUse, and enablementId from YAML frontmatter
          name = data.name || skillName;
          description = data.description || '';
          if (typeof data.whenToUse === 'string' && data.whenToUse.trim()) {
            whenToUse = data.whenToUse.trim();
          }
          enablementId = data.enablementId;

          // If enablementId is provided, check if the feature is enabled
          if (enablementId) {
            const features = getFeatures();

            // Warn if enablementId doesn't exist in configuration (typo detection)
            if (!(enablementId in features.enabledSkills)) {
              this.logger.warn('skill.list.unknown_feature_flag', {
                skill: skillName,
                enablementId,
                message: `Skill references unknown feature flag '${enablementId}'. Check features.ts configuration.`
              });
            }

            if (!skills.isEnabled(enablementId)) {
              this.logger.debug('skill.list.feature_disabled', {
                skill: skillName,
                enablementId
              });
              return null; // Skip this skill - feature is disabled
            }
          }
        } catch (error) {
          // If skill.md is missing or has no frontmatter, use directory name
          this.logger.debug('skill.list.frontmatter_missing', {
            skill: skillName,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        const skillItem: SkillListItem = { name, description };
        if (whenToUse) {
          skillItem.whenToUse = whenToUse;
        }
        if (enablementId) {
          skillItem.enablementId = enablementId;
        }
        return skillItem;
      });

      const allSkills = await Promise.all(skillPromises);

      // Filter out null values (disabled skills)
      const enabledSkills = allSkills.filter((skill): skill is SkillListItem => skill !== null);

      const totalSkillsCount = allSkills.length;
      const disabledCount = allSkills.filter(s => s === null).length;

      this.logger.info('skill.list.success', {
        count: enabledSkills.length,
        totalSkills: totalSkillsCount,
        disabledCount,
        skills: enabledSkills.map(s => s.name)
      });

      return {
        success: true,
        skills: enabledSkills
      };
    } catch (error) {
      this.logger.error('skill.list.error', {
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error listing skills'
      };
    }
  }

  /**
   * Parse dependencies from skill.md frontmatter
   * Validates package names to prevent malicious package installation
   * @private
   */
  private async parseSkillDependencies(skill: string): Promise<string[]> {
    try {
      const skillFile = this.getSkillPath(skill, 'skill.md');
      const skillContent = await fs.readFile(skillFile, 'utf-8');
      const { data } = matter(skillContent);

      if (Array.isArray(data.dependencies)) {
        return data.dependencies
          .filter((dep: unknown) => typeof dep === 'string')
          .filter((dep: string) => {
            if (!this.validatePackageName(dep)) {
              this.logger.warn('skill.dependencies.invalid_name', {
                skill,
                packageName: dep
              });
              return false;
            }
            return true;
          });
      }

      return [];
    } catch (error) {
      this.logger.warn('skill.dependencies.parse_failed', {
        skill,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Install a single npm package with retries using TerminalTool
   * @private
   */
  private async installPackage(
    packageName: string,
    appPath: string,
    appId: string,
    maxRetries: number = 3
  ): Promise<DependencyInstallResult> {
    let lastError: string | undefined;

    // Get dev supervisor client for the app
    const devSupervisorClient = DevSupervisorClientFactory.createForApp(appId);

    if (!devSupervisorClient) {
      this.logger.warn('skill.dependencies.no_dev_supervisor', {
        package: packageName,
        appId
      });
      return {
        package: packageName,
        success: false,
        error: 'Dev supervisor not available for package installation',
        retries: 0
      };
    }

    const terminalTool = new TerminalTool(devSupervisorClient);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      this.logger.info('skill.dependencies.install_attempt', {
        package: packageName,
        attempt: attempt + 1,
        maxRetries
      });

      try {
        const result = await terminalTool.executeCommand(appPath, {
          command: `npm install ${packageName}`,
          timeout: 60000 // 60 seconds for npm install
        });

        if (result.success) {
          this.logger.info('skill.dependencies.install_success', {
            package: packageName,
            attempts: attempt + 1
          });

          return {
            package: packageName,
            success: true,
            retries: attempt
          };
        }

        lastError = result.stderr || `npm install failed with exit code ${result.exitCode}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      this.logger.warn('skill.dependencies.install_retry', {
        package: packageName,
        attempt: attempt + 1,
        maxRetries,
        error: lastError
      });

      // Wait before retry with exponential backoff: 1s, 2s, 4s
      if (attempt < maxRetries - 1) {
        const backoffMs = 1000 * Math.pow(2, attempt);
        this.logger.debug('skill.dependencies.backoff', {
          package: packageName,
          backoffMs
        });
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    this.logger.error('skill.dependencies.install_failed', {
      package: packageName,
      attempts: maxRetries,
      error: lastError
    });

    const failResult: DependencyInstallResult = {
      package: packageName,
      success: false,
      retries: maxRetries - 1
    };

    if (lastError) {
      failResult.error = lastError;
    }

    return failResult;
  }

  /**
   * Install all skill dependencies using TerminalTool
   * @private
   */
  private async installDependencies(
    skill: string,
    appPath: string,
    appId: string
  ): Promise<DependencyInstallResult[]> {
    const dependencies = await this.parseSkillDependencies(skill);

    if (dependencies.length === 0) {
      this.logger.info('skill.dependencies.none', { skill });
      return [];
    }

    this.logger.info('skill.dependencies.start', {
      skill,
      dependencies,
      count: dependencies.length
    });

    const results: DependencyInstallResult[] = [];

    for (const dep of dependencies) {
      const result = await this.installPackage(dep, appPath, appId);
      results.push(result);
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    this.logger.info('skill.dependencies.complete', {
      skill,
      total: dependencies.length,
      success: successCount,
      failed: failCount
    });

    return results;
  }

  /**
   * Recursively load all template files from a directory
   * @private
   */
  private async loadTemplateFiles(dir: string, relativePath: string): Promise<TemplateFile[]> {
    const templates: TemplateFile[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          // Recursively load subdirectory
          const subTemplates = await this.loadTemplateFiles(fullPath, relPath);
          templates.push(...subTemplates);
        } else if (entry.isFile()) {
          // Load file content
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            templates.push({
              path: relPath,
              content
            });
          } catch (error) {
            this.logger.warn('skill.load.template_read_failed', {
              path: relPath,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('skill.load.templates_dir_error', {
        dir,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return templates;
  }
}
