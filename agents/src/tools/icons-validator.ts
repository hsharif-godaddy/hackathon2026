/**
 * Icon Validator Tool
 * 
 * Validates lucide-react icons using a comprehensive list extracted from the actual package.
 * Prevents runtime errors from hallucinated icon names while keeping all icons available.
 * Scans multiple files and provides detailed validation results.
 */

import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { LUCIDE_ICONS } from '../utils/lucide-icons-map.js';

export interface IconsValidatorOptions {
  files: string[];
  fixSuggestions: boolean;
}

export interface ValidationError {
  file: string;
  message: string;
  line?: number;
  icon?: string;
}

export interface ValidationWarning {
  file: string;
  message: string;
  line?: number;
}

export interface IconsValidationResult {
  valid: boolean;
  scannedFiles: string[];
  errors: ValidationError[];
  warnings: ValidationWarning[];
  fixSuggestions: string[];
}

/**
 * Extract icon names from lucide-react import statements with line numbers
 */
function extractLucideIcons(code: string): Array<{icon: string, line: number}> {
  const icons: Array<{icon: string, line: number}> = [];
  const lines = code.split('\n');

  // Match lucide-react import statements
  const lucideImportPattern = /import\s+\{([^}]+)\}\s+from\s+['"]lucide-react['"];?/;

  lines.forEach((line, index) => {
    const match = line.match(lucideImportPattern);
    if (match && match[1]) {
      const iconList = match[1];
      const lineNumber = index + 1;

      // Parse individual icon names
      const iconNames = iconList
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length > 0 && !name.includes(' as ')); // Skip renamed imports

      iconNames.forEach(iconName => {
        icons.push({ icon: iconName, line: lineNumber });
      });
    }
  });

  return icons;
}

/**
 * Scan directory for files to validate
 */
async function scanForFiles(appPath: string, specificFiles: string[] = []): Promise<string[]> {
  if (specificFiles.length > 0) {
    // Return specific files, ensuring they exist and are relative to appPath
    const files: string[] = [];
    for (const file of specificFiles) {
      const fullPath = join(appPath, file);
      try {
        await fs.access(fullPath);
        files.push(file);
      } catch {
        // File doesn't exist, skip it
      }
    }
    return files;
  }

  // Recursively scan for React/TS files
  const files: string[] = [];
  
  async function scanDir(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relativePath ? join(relativePath, entry.name) : entry.name;
        
        // Skip common directories that shouldn't contain source files
        if (entry.isDirectory()) {
          const skipDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'tmp'];
          if (!skipDirs.includes(entry.name)) {
            await scanDir(fullPath, relPath);
          }
        } else if (entry.isFile()) {
          // Only scan relevant file types
          const ext = extname(entry.name);
          if (['.tsx', '.ts', '.jsx', '.js'].includes(ext)) {
            files.push(relPath);
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }
  
  await scanDir(appPath);
  return files;
}

/**
 * Validate lucide-react icon imports across multiple files
 */
export async function validateLucideIcons(appPath: string, specificFiles: string[] = []): Promise<IconsValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const fixSuggestions: string[] = [];
  let scannedFiles: string[] = [];

  try {
    // Find files to scan
    scannedFiles = await scanForFiles(appPath, specificFiles);
    
    if (scannedFiles.length === 0) {
      warnings.push({
        file: 'project',
        message: 'No React/TypeScript files found to scan'
      });
      return {
        valid: true,
        scannedFiles: [],
        errors: [],
        warnings,
        fixSuggestions: []
      };
    }

    // Process each file
    for (const file of scannedFiles) {
      try {
        const fullPath = join(appPath, file);
        const code = await fs.readFile(fullPath, 'utf-8');
        
        // Extract icons from this file
        const importedIcons = extractLucideIcons(code);
        
        if (importedIcons.length === 0) {
          continue; // No icons in this file, skip
        }

        // Validate each imported icon
        for (const { icon, line } of importedIcons) {
          if (!LUCIDE_ICONS.has(icon)) {
            // Invalid icon found
            const similar = getSimilarIcons(icon);
            const suggestion = similar.length > 0 
              ? `Consider using: ${similar.slice(0, 3).join(', ')}`
              : 'Check available lucide-react icons';
            
            errors.push({
              file,
              message: `Invalid lucide-react icon "${icon}" - ${suggestion}`,
              line,
              icon
            });

            // Add to fix suggestions
            if (similar.length > 0) {
              fixSuggestions.push(`Replace "${icon}" in ${file}:${line} with one of: ${similar.slice(0, 3).join(', ')}`);
            }
          }
        }

      } catch (fileError) {
        warnings.push({
          file,
          message: `Could not read file: ${fileError instanceof Error ? fileError.message : 'Unknown error'}`
        });
      }
    }

    // Add general suggestions if there are errors
    if (errors.length > 0) {
      fixSuggestions.push(`Total available lucide-react icons: ${LUCIDE_ICONS.size}`);
      fixSuggestions.push('Visit https://lucide.dev/icons/ to browse all available icons');
    }

    return {
      valid: errors.length === 0,
      scannedFiles,
      errors,
      warnings,
      fixSuggestions
    };

  } catch (error) {
    // Return error as validation failure
    return {
      valid: false,
      scannedFiles: [],
      errors: [{
        file: 'validation',
        message: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }],
      warnings: [],
      fixSuggestions: []
    };
  }
}

/**
 * Get sample of available icons for reference
 */
export async function getIconSamples(): Promise<any[]> {
  return Array.from(LUCIDE_ICONS).slice(0, 20);
}

/**
 * Find similar icon names using string similarity algorithms
 */
function getSimilarIcons(invalidIcon: string): string[] {
  const suggestions: Array<{ icon: string; score: number }> = [];
  const maxSuggestions = 5;

  // Convert to lowercase for case-insensitive matching
  const target = invalidIcon.toLowerCase();

  for (const validIcon of LUCIDE_ICONS) {
    const candidate = validIcon.toLowerCase();

    // Calculate similarity score using multiple methods
    let score = 0;

    // 1. Exact substring match (highest priority)
    if (candidate.includes(target) || target.includes(candidate)) {
      score += 100;
    }

    // 2. Starts with same letters
    if (candidate.startsWith(target.substring(0, Math.min(3, target.length)))) {
      score += 50;
    }

    // 3. Levenshtein distance (lower distance = higher score)
    const distance = levenshteinDistance(target, candidate);
    const maxLen = Math.max(target.length, candidate.length);
    if (maxLen > 0) {
      score += Math.max(0, 30 - (distance / maxLen) * 30);
    }

    // 4. Common character ratio
    const commonChars = countCommonChars(target, candidate);
    const maxCharLen = Math.max(target.length, candidate.length);
    if (maxCharLen > 0) {
      score += (commonChars / maxCharLen) * 20;
    }

    if (score > 15) { // Only consider reasonably similar icons
      suggestions.push({ icon: validIcon, score });
    }
  }

  // Sort by score (descending) and return top suggestions
  const result = suggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSuggestions)
    .map(s => s.icon);

  // If no good matches, provide some common fallbacks
  if (result.length === 0) {
    return ['Check', 'Circle', 'Star', 'Plus', 'X'];
  }

  return result;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(0));

  for (let i = 0; i <= str1.length; i += 1) {
    const row = matrix[0];
    if (row) {
      row[i] = i;
    }
  }

  for (let j = 0; j <= str2.length; j += 1) {
    const row = matrix[j];
    if (row) {
      row[0] = j;
    }
  }

  for (let j = 1; j <= str2.length; j += 1) {
    for (let i = 1; i <= str1.length; i += 1) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      const currentRow = matrix[j];
      const prevRow = matrix[j - 1];
      if (currentRow && prevRow) {
        const left = currentRow[i - 1];
        const above = prevRow[i];
        const diagonal = prevRow[i - 1];
        if (left !== undefined && above !== undefined && diagonal !== undefined) {
          currentRow[i] = Math.min(
            left + 1, // deletion
            above + 1, // insertion
            diagonal + indicator, // substitution
          );
        }
      }
    }
  }

  const finalRow = matrix[str2.length];
  return finalRow ? finalRow[str1.length] ?? 0 : 0;
}

/**
 * Count common characters between two strings
 */
function countCommonChars(str1: string, str2: string): number {
  const chars1 = str1.split('');
  const chars2 = str2.split('');
  let common = 0;

  for (const char of chars1) {
    const index = chars2.indexOf(char);
    if (index !== -1) {
      common++;
      chars2.splice(index, 1); // Remove to avoid double counting
    }
  }

  return common;
}
