/**
 * Post-edit handler for the content layer on the agent's own `.ts`/`.tsx` page
 * writes.
 *
 * Two behaviors share one trigger (a `.ts`/`.tsx` write under the app source
 * tree, outside `src/content/`):
 *
 *  1. AUTO-CONFORM (page creates only): when the agent writes a whole new
 *     `src/pages/*.tsx` whose body inlines a strictly-safe array literal, this
 *     conforms it to the content layer — moving the array into `virtual:content`
 *     and rewriting the page to consume it — so inline editing works without the
 *     agent having to call `content_scaffold` by hand. Ungated. Safety comes
 *     from a strict gate, a snapshot→apply→validate→rollback boundary, and a
 *     fail-safe wrapper: the worst case is "advisory message, files restored."
 *  2. ADVISORY (everything else, or when conform declines/fails): re-reads the
 *     file and runs the content-rules linter; any violations are appended to the
 *     tool result so the agent self-corrects on the next turn.
 *
 * Files under `src/content/` (the content JSON / schemas the layer produces)
 * are skipped — the rules are about presentation files wiring text through
 * `virtual:content`.
 *
 * I/O boundary: every read/write/delete of a CUSTOMER-APP file goes through the
 * Workspace API (`resolveWorkspaceFiles`) — never raw `node:fs` — mirroring
 * `SeoRoutesSynchronizer`. The page, `vite.config.ts`, the `src/content/index.ts`
 * barrel, and ALL snapshot/restore reads+writes route through one `WorkspaceFiles`
 * client so behavior is identical across AAB / PaaS / local and the snapshot set
 * is captured and restored through a single, consistent mechanism.
 *
 * Carve-out: `scaffoldContent` writes the content JSON/schema/.d.ts via `node:fs`
 * to `path.join(appPath, 'src/content')` — it is not workspace-aware, and we call
 * it as-is, mirroring the production `content_scaffold` AI tool. Both the
 * Workspace API and scaffold's `node:fs` resolve to the same tree at runtime
 * (the API confines to `/app`, which is `appPath` in prod; in tests the injected
 * client is rooted at the same temp `appPath`). Snapshot/restore of those content
 * files therefore still goes through the Workspace API (the one chosen mechanism)
 * so rollback is byte-consistent with how the page is restored.
 *
 * Durability: `files.write` is atomic at the supervisor layer (tmp + same-dir
 * rename, parent dirs created), so there is no truncate-then-write window for the
 * page or any restore-write. No `node:fs` write of a customer file happens here.
 *
 * Best-effort: the write has already succeeded by the time this runs, so a
 * read/lint/conform failure must never alter the result the agent sees beyond
 * the original success message — we'd rather lose advisory signal (and skip the
 * conform) than block a legitimate edit.
 */

import { extname, relative } from 'node:path';

import { logger } from '../logging/index.js';
import type {
  PostEditContext,
  PostEditHandler,
} from '../tools/ai-lib-tools/post-edit-handlers.js';
import {
  checkContentRulesForFile,
  type RuleViolation,
} from '../tools/content-rules-lint.js';
import { conformPageToContentLayer } from './content-conform.js';
import type { WorkspaceFilesFactory } from './content-conform.js';

const CONTENT_ROOT: string = 'src/content/';
const PAGE_FILE_PATTERN: RegExp = /^src\/pages\/[^/]+\.tsx$/;

function formatViolations(relPath: string, violations: RuleViolation[]): string {
  const header: string = `⚠️ content-rules-lint found ${violations.length} issue${violations.length === 1 ? '' : 's'} in ${relPath}:`;
  const lines: string[] = violations.map((v: RuleViolation): string => {
    const where: string = v.line ? `${relPath}:${v.line}` : relPath;
    return `  [${v.rule}] ${where} — ${v.message}`;
  });
  return [
    header,
    ...lines,
    '',
    'Address these by calling `content_scaffold` and/or restructuring imports before continuing.',
  ].join('\n');
}

export interface ContentRulesPostEditDeps {
  /** Override the workspace binding (tests inject a temp-dir-backed client). */
  workspaceFactory?: WorkspaceFilesFactory;
}

/**
 * Build the handler with injectable workspace access. The default-deps instance
 * is exported below as `contentRulesPostEditHandler` and registered at the tool
 * composition root; tests construct their own instance with a temp-dir client.
 */
export function createContentRulesPostEditHandler(
  deps: ContentRulesPostEditDeps = {},
): PostEditHandler {
  return {
    name: 'content-rules-lint',

    matches(relPath: string): boolean {
      const ext: string = extname(relPath);
      if (ext !== '.ts' && ext !== '.tsx') return false;
      if (relPath.startsWith(CONTENT_ROOT)) return false;
      return true;
    },

    async run(context: PostEditContext, result: string): Promise<string> {
      const { appId, appPath, fullPath, command } = context;
      // The auto-conform path owns all customer-file I/O via the Workspace API.
      // It is fully fail-safe: on any decline/failure it restores every touched
      // file and returns { note: null }, so we can safely fall through to the
      // advisory path below using the source it read back from disk.
      const conform: { note: string | null; source: string | null } =
        await conformPageToContentLayer({
          appId,
          appPath,
          fullPath,
          command,
          isPageCreate: command === 'create' && PAGE_FILE_PATTERN.test(relativeOf(context)),
          workspaceFactory: deps.workspaceFactory,
        });

      if (conform.note !== null) {
        return `${result}\n\n${conform.note}`;
      }

      // No conform happened (declined, rolled back, or not a page-create). Use
      // the on-disk source the conform path read back for us; if it couldn't read
      // the file at all, leave the agent's result untouched (fail-safe).
      if (conform.source === null) {
        return result;
      }

      const relPath: string = relativeOf(context);
      let violations: RuleViolation[];
      try {
        violations = checkContentRulesForFile(conform.source, relPath);
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
        ruleTypes: [...new Set(violations.map((v: RuleViolation): string => v.rule))],
      });

      return `${result}\n\n${formatViolations(relPath, violations)}`;
    },
  };
}

/**
 * App-relative path of the edited file. Uses the validated, prefix-translated
 * `fullPath` (not the raw LLM `filePath`) so page/component heuristics keyed on
 * `src/pages` / `src/components` resolve correctly. `node:path.relative` is a
 * pure string op — the file BYTES are only ever touched through the Workspace
 * API in content-conform.
 */
function relativeOf(context: PostEditContext): string {
  return relative(context.appPath, context.fullPath);
}

/** Default-deps handler, registered at the tool composition root. */
export const contentRulesPostEditHandler: PostEditHandler = createContentRulesPostEditHandler();
