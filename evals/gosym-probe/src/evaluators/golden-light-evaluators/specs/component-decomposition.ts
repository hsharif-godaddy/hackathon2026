import { clamp01 } from '../../shared.js';
import type { StructuralEvalSpec, StructuralScoreResult } from '../dom-eval-types.js';
import { safeRatio } from '../dom-eval-types.js';

const DEV_FILE_RE = /\bdata-dev-file\s*=\s*["']([^"']+)["']/gi;

/** Extract the directory segment from a file path (everything before the last `/`). */
function dirOf(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash > 0 ? filePath.slice(0, lastSlash) : '.';
}

/**
 * File count sub-score: normalised against a target of 5 unique files.
 * 1 file → 0,  5+ files → 1.0.
 */
// Divisor used to normalise unique-file count into a 0–1 score: (uniqueFiles - 1) / FILE_COUNT_DIVISOR
const FILE_COUNT_DIVISOR = 4;
function fileCountScore(uniqueFiles: number): number {
  return clamp01((uniqueFiles - 1) / FILE_COUNT_DIVISOR);
}

/**
 * Directory separation sub-score: normalised against a target of 3 unique directories.
 * 1 dir → 0,  3+ dirs → 1.0.
 */
// Divisor used to normalise unique-directory count into a 0–1 score: (uniqueDirs - 1) / DIR_SEPARATION_DIVISOR
const DIR_SEPARATION_DIVISOR = 2;
function dirSeparationScore(uniqueDirs: number): number {
  return clamp01((uniqueDirs - 1) / DIR_SEPARATION_DIVISOR);
}

export const componentDecompositionSpec: StructuralEvalSpec = {
  name: 'component-decomposition',
  dimension: 'component-decomposition',
  description: 'Measures component diversity via data-dev-file attrs: file count (0.4) + dir separation (0.4) + reuse (0.2)',
  evalVersion: '1.0',
  keepDevAttributes: true,

  score(bodyHtml: string): StructuralScoreResult {
    const allFiles = [...bodyHtml.matchAll(DEV_FILE_RE)].map((m) => m[1]);

    if (allFiles.length === 0) {
      return {
        score: 0,
        canScore: false,
        reason: 'No data-dev-file attributes found',
        details: { uniqueFiles: 0, uniqueDirs: 0, reusedComponents: 0 },
      };
    }

    const uniqueFilesSet = new Set(allFiles);
    const uniqueDirsSet = new Set([...uniqueFilesSet].map(dirOf));

    // Build counts once — O(n) — and derive both reuse sub-score and detail count from it.
    const fileCounts = new Map<string, number>();
    for (const f of allFiles) fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
    const reusedComponents = [...fileCounts.values()].filter((c) => c > 1).length;
    const reuseSub = safeRatio(reusedComponents, uniqueFilesSet.size);

    const fileSub = fileCountScore(uniqueFilesSet.size);
    const dirSub = dirSeparationScore(uniqueDirsSet.size);
    const score = clamp01(0.4 * fileSub + 0.4 * dirSub + 0.2 * reuseSub);

    return {
      score,
      canScore: true,
      reason: `${uniqueFilesSet.size} unique file(s) across ${uniqueDirsSet.size} director(y/ies)`,
      details: {
        uniqueFiles: uniqueFilesSet.size,
        uniqueDirs: uniqueDirsSet.size,
        reusedComponents,
        fileCountScore: fileSub,
        dirSeparationScore: dirSub,
        reuseScore: reuseSub,
      },
    };
  },
};
