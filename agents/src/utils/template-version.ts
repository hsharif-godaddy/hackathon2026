import path from 'path';

/**
 * Extract template version from template directory path
 * 
 * @param templateDir - The template directory path (e.g., 'app-templates/v3', '/path/to/v2')
 * @returns The template version (last directory name) or 'v3' as default
 * 
 * @example
 * extractTemplateVersion('app-templates/v1') // returns 'v1'
 * extractTemplateVersion('/absolute/path/to/v2') // returns 'v2'
 * extractTemplateVersion('custom-template') // returns 'custom-template'
 * extractTemplateVersion('') // returns 'v3'
 */
export function extractTemplateVersion(templateDir: string): string {
  const lastDir = path.basename(templateDir);
  return lastDir || 'v3';
}

/**
 * Get template name for composition based on template directory path
 * Used by BaseAgent for environment variable fallback
 * 
 * @param templateDir - The template directory path
 * @returns The template name or 'default' for invalid paths
 * 
 * @example
 * getTemplateFromEnvironment('app-templates/v1') // returns 'v1'
 * getTemplateFromEnvironment('.') // returns 'default'
 * getTemplateFromEnvironment('') // returns 'default'
 */
export function getTemplateFromEnvironment(templateDir: string): string {
  const lastDir = path.basename(templateDir);
  if (lastDir && lastDir !== '.' && lastDir !== '') {
    return lastDir;
  }
  return 'default';
}
