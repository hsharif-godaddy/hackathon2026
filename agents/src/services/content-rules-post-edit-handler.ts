/**
 * Post-edit handler that surfaces content-layer rule violations on the agent's
 * own file writes. After a `.ts`/`.tsx` write under the app source tree, it
 * re-reads the file and runs the content-rules linter; any violations are
 * appended to the tool result so the agent self-corrects on the next turn
 * without needing a separate validation pass.
 *
 * Files under `src/content/` (the content JSON / schemas the layer produces)
 * are skipped — the rules are about presentation files wiring text through
 * `virtual:content`.
 *
 * Best-effort: the write has already succeeded by the time this runs, so a
 * read or lint failure must never alter the result the agent sees beyond the
 * original success message — we'd rather lose advisory signal than block a
 * legitimate edit.
 */

import { readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

import { logger } from '../logging/index.js';
import type {
  PostEditContext,
  PostEditHandler,
} from '../tools/ai-lib-tools/post-edit-handlers.js';
import {
  checkContentRulesForFile,
  type RuleViolation,
} from '../tools/content-rules-lint.js';

const CONTENT_ROOT = 'src/content/';

function formatViolations(relPath: string, violations: RuleViolation[]): string {
  const header = `⚠️ content-rules-lint found ${violations.length} issue${violations.length === 1 ? '' : 's'} in ${relPath}:`;
  const lines = violations.map((v) => {
    const where = v.line ? `${relPath}:${v.line}` : relPath;
    return `  [${v.rule}] ${where} — ${v.message}`;
  });
  return [
    header,
    ...lines,
    '',
    'Address these by calling `content_scaffold` and/or restructuring imports before continuing.',
  ].join('\n');
}

export const contentRulesPostEditHandler: PostEditHandler = {
  name: 'content-rules-lint',

  matches(relPath: string): boolean {
    const ext = extname(relPath);
    if (ext !== '.ts' && ext !== '.tsx') return false;
    if (relPath.startsWith(CONTENT_ROOT)) return false;
    return true;
  },

  async run(context: PostEditContext, result: string): Promise<string> {
    const { appId, appPath, fullPath } = context;
    // Use the app-relative path (not the raw LLM-emitted `filePath`, which may
    // be Docker-prefixed) so the linter's page/component heuristics — keyed on
    // `src/pages` / `src/components` prefixes — resolve correctly.
    const relPath = relative(appPath, fullPath);

    // Defense-in-depth: fullPath is server-derived, but confine reads to the
    // app directory so a corrupt/adversarial path can't escape the workspace.
    const resolvedFull = resolve(fullPath);
    if (resolvedFull !== resolve(appPath) && !resolvedFull.startsWith(resolve(appPath) + sep)) {
      return result; // outside the app dir — refuse
    }

    let source: string;
    try {
      source = await readFile(fullPath, 'utf-8');
    } catch (err) {
      logger.warn('content-rules-lint.post-edit.read-failed', {
        appId,
        filePath: relPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return result;
    }

    let violations: RuleViolation[];
    try {
      violations = checkContentRulesForFile(source, relPath);
    } catch (err) {
      logger.warn('content-rules-lint.post-edit.checker-threw', {
        appId,
        filePath: relPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return result;
    }

    if (violations.length === 0) return result;

    logger.info('content-rules-lint.post-edit.violations', {
      appId,
      filePath: relPath,
      violationCount: violations.length,
      ruleTypes: [...new Set(violations.map((v) => v.rule))],
    });

    return `${result}\n\n${formatViolations(relPath, violations)}`;
  },
};
