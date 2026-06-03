/**
 * Icon Validator Tool
 * 
 * Validates lucide-react icons using a comprehensive list extracted from the actual package.
 * Prevents runtime errors from hallucinated icon names while keeping all icons available.
 * Scans multiple files and provides detailed validation results.
 */

import type { WorkspaceFiles, StatEntryFound } from '../workspace/files.js';
import { isDevSupervisorNotFound } from '../services/DevSupervisorClient.js';
import { LUCIDE_ICONS } from '../utils/lucide-icons-map.js';

export interface IconsValidatorOptions {
  files: string[];
  fixSuggestions: boolean;
}

/**
 * Directory names pruned during the recursive scan. Matched as slash-free
 * excludeGlobs, so the dev-supervisor walker skips these subtrees at any depth.
 */
const SCAN_SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'tmp'];

/** Extensions scanned in recursive mode, expressed as basename includeGlobs. */
const SCAN_INCLUDE_GLOBS = ['*.tsx', '*.ts', '*.jsx', '*.js'];

/** Max concurrent per-file `view` calls when reading scanned files. */
const FILE_READ_CONCURRENCY = 10;

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
 * Resolve the set of workspace-relative files to validate.
 *
 * - With explicit `specificFiles`, each path is stat'd in one batch and only
 *   existing regular files are kept (missing paths and directories drop out).
 * - Otherwise the workspace is walked via `tree`, restricted to source-file
 *   extensions with the standard build/vendor directories pruned server-side.
 *
 * Paths are returned workspace-rooted, ready to hand straight to `view`.
 * `truncated` is true when the recursive walk hit the supervisor's entry cap,
 * so callers can warn that the scan covered only a subset of files. The
 * explicit-files branch is never truncated (`stat` returns every path asked).
 */
async function scanForFiles(
  files: WorkspaceFiles,
  specificFiles: string[] = [],
): Promise<{ paths: string[]; truncated: boolean }> {
  if (specificFiles.length > 0) {
    const { entries } = await files.stat({ paths: specificFiles });
    return {
      paths: entries
        .filter((e): e is StatEntryFound => !('error' in e) && e.kind === 'file')
        .map((e) => e.path),
      truncated: false,
    };
  }

  const { entries, truncated } = await files.tree({
    recursive: true,
    kindFilter: 'file',
    includeGlobs: SCAN_INCLUDE_GLOBS,
    excludeGlobs: SCAN_SKIP_DIRS,
  });
  return { paths: entries.map((e) => e.path), truncated };
}

interface FileValidation {
  errors: ValidationError[];
  warnings: ValidationWarning[];
  fixSuggestions: string[];
}

/**
 * Validate the lucide-react imports in a single file.
 *
 * Reads the file via `view`. A `not_found` (the file vanished between scan and
 * read) is downgraded to a warning; any other failure — including transport
 * errors talking to dev-supervisor — propagates so it is not silently masked.
 */
async function validateFile(files: WorkspaceFiles, file: string): Promise<FileValidation> {
  const result: FileValidation = { errors: [], warnings: [], fixSuggestions: [] };

  let code: string;
  try {
    ({ content: code } = await files.view({ path: file }));
  } catch (err) {
    if (isDevSupervisorNotFound(err)) {
      result.warnings.push({ file, message: 'Could not read file: not found' });
      return result;
    }
    throw err;
  }

  for (const { icon, line } of extractLucideIcons(code)) {
    if (LUCIDE_ICONS.has(icon)) {
      continue;
    }
    const similar = getSimilarIcons(icon);
    const suggestion =
      similar.length > 0
        ? `Consider using: ${similar.slice(0, 3).join(', ')}`
        : 'Check available lucide-react icons';

    result.errors.push({
      file,
      message: `Invalid lucide-react icon "${icon}" - ${suggestion}`,
      line,
      icon,
    });

    if (similar.length > 0) {
      result.fixSuggestions.push(
        `Replace "${icon}" in ${file}:${line} with one of: ${similar.slice(0, 3).join(', ')}`,
      );
    }
  }

  return result;
}

/**
 * Validate lucide-react icon imports across the workspace.
 *
 * All filesystem access goes through the supplied {@link WorkspaceFiles} client
 * (dev-supervisor) — never the host filesystem. Transport failures propagate;
 * only a per-file `not_found` is downgraded to a warning.
 */
export async function validateLucideIcons(
  files: WorkspaceFiles,
  specificFiles: string[] = [],
): Promise<IconsValidationResult> {
  const { paths: scannedFiles, truncated } = await scanForFiles(files, specificFiles);

  if (scannedFiles.length === 0) {
    return {
      valid: true,
      scannedFiles: [],
      errors: [],
      warnings: [{ file: 'project', message: 'No React/TypeScript files found to scan' }],
      fixSuggestions: [],
    };
  }

  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const fixSuggestions: string[] = [];

  // A truncated walk means we validated only a subset of source files; surface
  // it so a partial scan is not mistaken for a clean, complete pass.
  if (truncated) {
    warnings.push({
      file: 'project',
      message: 'File scan truncated at the workspace limit; not all files were validated',
    });
  }

  for (let i = 0; i < scannedFiles.length; i += FILE_READ_CONCURRENCY) {
    const batch = scannedFiles.slice(i, i + FILE_READ_CONCURRENCY);
    const batchResults = await Promise.all(batch.map((file) => validateFile(files, file)));
    for (const r of batchResults) {
      errors.push(...r.errors);
      warnings.push(...r.warnings);
      fixSuggestions.push(...r.fixSuggestions);
    }
  }

  if (errors.length > 0) {
    fixSuggestions.push(`Total available lucide-react icons: ${LUCIDE_ICONS.size}`);
    fixSuggestions.push('Visit https://lucide.dev/icons/ to browse all available icons');
  }

  return {
    valid: errors.length === 0,
    scannedFiles,
    errors,
    warnings,
    fixSuggestions,
  };
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
