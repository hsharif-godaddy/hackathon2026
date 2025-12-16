import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { logger } from '../logging/index.js';
import { skills, getFeatures } from '../services/features.js';

/**
 * Options for loading a skill
 */
export interface SkillLoaderOptions {
  /** Name of the skill to load (e.g., 'blog', 'commerce') */
  skill: string;
}

/**
 * Options for installing skill templates
 */
export interface InstallTemplatesOptions {
  /** Name of the skill */
  skill: string;
  /** Base directory where app code lives (e.g., '/tmp/apps/abc123/app') */
  appPath: string;
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
 * Result of installing skill templates
 */
export interface InstallTemplatesResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Name of the skill */
  skill: string;
  /** Number of files copied */
  filesInstalled?: number;
  /** List of installed file paths */
  installedFiles?: string[];
  /** Error message if operation failed */
  error?: string;
}

/**
 * Skill list item with metadata from YAML frontmatter
 */
export interface SkillListItem {
  name: string;
  description: string;
  enablementId?: string;
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
    const { skill, appPath } = options;

    this.logger.info('skill.install.start', {
      skill,
      appPath
    });

    try {
      // Use helper to safely construct paths (validates internally)
      const templatesDir = this.getSkillPath(skill, 'templates');

      // Check if skill and templates exist
      try {
        await fs.access(templatesDir);
      } catch {
        this.logger.warn('skill.install.no_templates', { skill });
        return {
          success: false,
          skill,
          error: `Skill '${skill}' has no templates directory`
        };
      }

      // Get all template files
      const templates = await this.loadTemplateFiles(templatesDir, '');

      if (templates.length === 0) {
        this.logger.warn('skill.install.empty_templates', { skill });
        return {
          success: false,
          skill,
          error: `Skill '${skill}' has no template files`
        };
      }

      const installedFiles: string[] = [];

      // Copy each template file to destination
      for (const template of templates) {
        const destPath = this.getDestinationPath(skill, template.path, appPath);

        try {
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

      this.logger.info('skill.install.success', {
        skill,
        filesInstalled: installedFiles.length
      });

      return {
        success: true,
        skill,
        filesInstalled: installedFiles.length,
        installedFiles
      };
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
        let enablementId: string | undefined;

        try {
          const skillFile = this.getSkillPath(skillName, 'skill.md');
          const skillContent = await fs.readFile(skillFile, 'utf-8');
          const { data } = matter(skillContent);

          // Extract name, description, and enablementId from YAML frontmatter
          name = data.name || skillName;
          description = data.description || '';
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
