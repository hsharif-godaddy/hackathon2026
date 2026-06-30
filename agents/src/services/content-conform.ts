/**
 * Auto-conform a freshly-created page to the content layer.
 *
 * Owns the snapshot → apply → validate → rollback boundary that
 * `contentRulesPostEditHandler` delegates to. Every customer-app file is read,
 * written, and deleted through the Workspace API (`resolveWorkspaceFiles`) — the
 * single mechanism used for the page rewrite AND for snapshot/restore — so the
 * rollback is byte-consistent and the path behaves identically across AAB /
 * PaaS / local.
 *
 * Carve-out: `scaffoldContent` writes the content JSON / schema / `.d.ts` via
 * `node:fs` (it is not workspace-aware). We call it unchanged, mirroring the
 * production `content_scaffold` AI tool; both the Workspace API and scaffold's
 * `node:fs` resolve to the same tree at runtime. We therefore snapshot+restore
 * the content files it touches through the Workspace API too, keeping all
 * rollback on the one chosen mechanism. See the handler module header.
 *
 * `files.write` is atomic at the supervisor layer (tmp + same-dir rename), so
 * the page write and every restore-write are atomic with no truncate window.
 *
 * Fail-safe: nothing here throws out of `conformPageToContentLayer`. On any
 * decline or failure it restores every snapshot, logs, and returns
 * `{ note: null }`, plus the on-disk page source for the caller's advisory pass.
 */

import { join } from 'node:path';

import { parse as babelParse } from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import traverseDefault from '@babel/traverse';
import * as t from '@babel/types';

import { logger } from '../logging/index.js';
import {
  analyzeExtractable,
  planPageExtraction,
  type ExtractionPlan,
} from '../tools/content-extract.js';
// Namespace import so the in-process call sites stay spy-able in tests and the
// barrel-removal mirror reuses the same wrapper the AI tool uses.
import * as contentScaffold from '../tools/content-scaffold.js';
import { getErrorMessage } from '../utils/error.js';
import { createForWorkspace } from '../workspace/index.js';
import { resolveWorkspaceFiles } from '../workspace/resolve.js';
import type { CreateForWorkspace } from '../workspace/client.js';
import type { WorkspaceFiles } from '../workspace/files.js';
import type { PostEditCommand } from '../tools/ai-lib-tools/post-edit-handlers.js';

/** The workspace-binding factory shape this module depends on (default `createForWorkspace`). */
export type WorkspaceFilesFactory = CreateForWorkspace;

export interface ConformInput {
  appId: string;
  appPath: string;
  fullPath: string;
  command: PostEditCommand;
  /** Precomputed `command === 'create' && src/pages/*.tsx`. */
  isPageCreate: boolean;
  workspaceFactory?: WorkspaceFilesFactory;
}

export interface ConformOutcome {
  /** Conformed-note to append on success; `null` when nothing was conformed. */
  note: string | null;
  /** On-disk page source (post-rollback if applicable) for the caller's advisory pass; `null` when unreadable. */
  source: string | null;
}

const PARSE_OPTS: { sourceType: 'module'; plugins: ['jsx', 'typescript'] } = {
  sourceType: 'module',
  plugins: ['jsx', 'typescript'],
};

// @babel/traverse ships a CJS default-export interop quirk under ESM bundlers.
// This is the sanctioned `any` unwrap (matches content-extract.ts /
// content-rules-lint.ts); the visitor callbacks below are explicitly typed.
const traverse: any = (traverseDefault as any).default ?? traverseDefault;

/** Workspace-relative paths of the files this conform may touch (snapshot set). */
const VITE_CONFIG: string = 'vite.config.ts';
const CONTENT_BARREL: string = 'src/content/index.ts';
const CONTENT_SCHEMAS: string = 'src/content/schemas.ts';
const CONTENT_DTS: string = 'src/content/virtual-content.d.ts';
const CONTENT_USER_EDITS: string = 'src/content/.user-edits.json';

/** A file's prior bytes, or `null` when it did not exist before. */
interface Snapshot {
  relPath: string;
  before: string | null;
}

/**
 * Resolve the Workspace API files client, or `null` (logged) when the workspace
 * is not bindable — in which case the caller falls through to advisory. Never
 * falls back to `node:fs` for customer files (per agents/CLAUDE.md).
 */
function resolveFiles(
  appId: string,
  factory: WorkspaceFilesFactory,
): WorkspaceFiles | null {
  try {
    return resolveWorkspaceFiles(appId, 'preview', factory);
  } catch (err) {
    logger.info('content-extract.skipped', {
      appId,
      reason: `workspace unavailable: ${getErrorMessage(err)}`,
    });
    return null;
  }
}

/** Read a workspace file's text, or `null` when it does not exist. Other errors propagate. */
async function readMaybe(files: WorkspaceFiles, relPath: string): Promise<string | null> {
  const stat = await files.stat({ paths: [relPath] });
  const entry = stat.entries[0];
  if (!entry || ('error' in entry && entry.error)) return null;
  const view = await files.view({ path: relPath });
  return view.content;
}

/** Snapshot current bytes (or absence) so the file can be restored verbatim. */
async function snapshotFile(files: WorkspaceFiles, relPath: string): Promise<Snapshot> {
  try {
    return { relPath, before: await readMaybe(files, relPath) };
  } catch (err) {
    // A read failure during snapshot would make rollback unsound — abort the
    // conform by throwing; the caller's catch turns this into advisory.
    throw new Error(`snapshot read failed for ${relPath}: ${getErrorMessage(err)}`);
  }
}

/** Restore a snapshotted file to its prior bytes, deleting it if it was absent. */
async function restore(files: WorkspaceFiles, snap: Snapshot): Promise<void> {
  if (snap.before === null) {
    // Idempotent delete: a never-created file is already in the desired state.
    try {
      await files.delete({ path: snap.relPath });
    } catch {
      // best-effort — absent is the goal
    }
    return;
  }
  await files.write({ path: snap.relPath, content: snap.before });
}

/** Strip the content-layer `id` minted onto each collection item. */
function withoutId(item: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = item;
  return rest;
}

/** Keys whose value is an array in a content JSON blob (null/invalid ⇒ empty). */
function arrayKeys(raw: string | null): Set<string> {
  if (raw === null) return new Set<string>();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return new Set<string>();
    return new Set<string>(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, v]: [string, unknown]): boolean => Array.isArray(v))
        .map(([k]: [string, unknown]): string => k),
    );
  } catch {
    return new Set<string>();
  }
}

interface ValidationContext {
  files: WorkspaceFiles;
  pageRel: string;
  plan: ExtractionPlan;
  /** Pristine pre-scaffold clone of the extracted data (ids not yet minted). */
  expected: Record<string, Record<string, unknown>[]>;
  /**
   * Array names that already existed in the page's content JSON before this
   * conform. For these, scaffold's `merge` semantics legitimately preserve
   * user-locked on-disk values over the freshly-inlined data, so a strict
   * round-trip equality would false-fail — we only structurally check them.
   * Strict fidelity is enforced on newly-introduced arrays.
   */
  preExistingArrays: Set<string>;
}

/**
 * AST-based structural validation of the rewritten tree. NO dynamic `RegExp`:
 * the rewritten page is re-parsed once with @babel/parser and walked. Returns
 * `null` on success or a reason string (⇒ caller rolls back).
 */
async function validateConform(ctx: ValidationContext): Promise<string | null> {
  const { files, pageRel, plan, expected } = ctx;

  const newPage: string = (await files.view({ path: pageRel })).content;
  let ast: t.File;
  try {
    ast = babelParse(newPage, PARSE_OPTS) as unknown as t.File;
  } catch (err) {
    return `rewritten page does not re-parse: ${getErrorMessage(err)}`;
  }

  // 1. An `import { <binding> } from 'virtual:content'` exists.
  if (!importsBinding(ast, plan.binding)) {
    return `rewritten page does not import '${plan.binding}' from virtual:content`;
  }

  // 2. For each extracted array: exactly one `<binding>.<name>.map` member/call
  //    chain survives, and no top-level `const <name>` remains.
  const surfaceConsts: Set<string> = moduleLevelConstNames(ast);
  for (const name of plan.extractedNames) {
    if (countBindingMapChain(ast, plan.binding, name) !== 1) {
      return `rewritten page is missing \`${plan.binding}.${name}.map\``;
    }
    if (surfaceConsts.has(name)) {
      return `rewritten page still declares \`const ${name}\``;
    }
  }

  // 3. Round-trip fidelity: each array re-read from JSON, ids stripped,
  //    deep-equals the PRE-scaffold clone (independent of scaffold's mutation).
  let onDisk: Record<string, unknown>;
  try {
    const raw: string | null = await readMaybe(files, `src/content/pages/${plan.binding}.json`);
    if (raw === null) return `pages/${plan.binding}.json was not written`;
    onDisk = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    return `could not re-read pages/${plan.binding}.json: ${getErrorMessage(err)}`;
  }
  for (const name of plan.extractedNames) {
    const actual: unknown = onDisk[name];
    if (!Array.isArray(actual)) return `pages/${plan.binding}.json is missing array '${name}'`;
    // Pre-existing arrays go through scaffold's merge/lock path, which may
    // legitimately keep on-disk values over the inlined ones — structural check
    // only. Newly-introduced arrays must round-trip exactly.
    if (ctx.preExistingArrays.has(name)) continue;
    const want: Record<string, unknown>[] = expected[name]!.map(withoutId);
    const got: Record<string, unknown>[] = actual.map((item: unknown): Record<string, unknown> =>
      item !== null && typeof item === 'object'
        ? withoutId(item as Record<string, unknown>)
        : (item as Record<string, unknown>),
    );
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      return `round-trip mismatch for '${name}' in pages/${plan.binding}.json`;
    }
  }

  // 4. vite.config.ts registers the content plugin.
  const vite: string | null = await readMaybe(files, VITE_CONFIG);
  if (vite === null || !vite.includes('contentPlugin')) {
    return 'vite.config.ts does not register contentPlugin after conform';
  }

  return null;
}

// ── AST helpers (no dynamic RegExp anywhere) ──────────────────────────────────

function importsBinding(ast: t.File, binding: string): boolean {
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node) || node.source.value !== 'virtual:content') continue;
    if (
      node.specifiers.some(
        (s: t.ImportDeclaration['specifiers'][number]): boolean =>
          t.isImportSpecifier(s) && t.isIdentifier(s.imported, { name: binding }),
      )
    ) {
      return true;
    }
  }
  return false;
}

function moduleLevelConstNames(ast: t.File): Set<string> {
  const out: Set<string> = new Set<string>();
  for (const stmt of ast.program.body) {
    if (!t.isVariableDeclaration(stmt) || stmt.kind !== 'const') continue;
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id)) out.add(decl.id.name);
    }
  }
  return out;
}

/**
 * Count `<binding>.<name>.map` member/call chains: a CallExpression whose callee
 * is `<binding>.<name>.map` (MemberExpression(.map) → MemberExpression(.name) →
 * Identifier(binding)). Structural — no regex.
 */
function countBindingMapChain(ast: t.File, binding: string, name: string): number {
  let count: number = 0;
  traverse(ast, {
    MemberExpression(path: NodePath<t.MemberExpression>): void {
      const mapMember: t.MemberExpression = path.node;
      if (mapMember.computed || !t.isIdentifier(mapMember.property, { name: 'map' })) return;
      const nameMember: t.Node = mapMember.object;
      if (
        !t.isMemberExpression(nameMember) ||
        nameMember.computed ||
        !t.isIdentifier(nameMember.property, { name })
      ) {
        return;
      }
      if (!t.isIdentifier(nameMember.object, { name: binding })) return;
      if (!t.isCallExpression(path.parent) || path.parent.callee !== mapMember) return;
      count += 1;
    },
  });
  return count;
}

function conformedNote(plan: ExtractionPlan): string {
  const moves: string = plan.extractedNames
    .map((name: string): string => `\`${name}\` → \`${plan.binding}.${name}\``)
    .join(', ');
  const consts: string =
    plan.extractedNames.length === 1
      ? `the local \`const ${plan.extractedNames[0]}\` was removed`
      : `the local \`const\` declarations were removed`;
  return [
    `Conformed to the content layer: moved ${moves} into \`virtual:content\`.`,
    `The page now imports \`${plan.binding}\`; ${consts}.`,
  ].join(' ');
}

/**
 * Entry point. Reads the page via the Workspace API, runs the gate, and on a
 * page-create with extractable arrays performs the snapshot→apply→validate→
 * rollback conform. Always returns; never throws.
 */
export async function conformPageToContentLayer(input: ConformInput): Promise<ConformOutcome> {
  const { appId, appPath, fullPath, isPageCreate } = input;
  const factory: WorkspaceFilesFactory = input.workspaceFactory ?? createForWorkspace;

  const files: WorkspaceFiles | null = resolveFiles(appId, factory);
  if (files === null) {
    // No usable client — fail-safe: caller leaves the result untouched.
    return { note: null, source: null };
  }

  const pageRel: string = workspaceRelative(appPath, fullPath);

  let source: string | null;
  try {
    source = await readMaybe(files, pageRel);
  } catch (err) {
    logger.warn('content-rules-lint.post-edit.read-failed', {
      appId,
      filePath: pageRel,
      error: getErrorMessage(err),
    });
    return { note: null, source: null };
  }
  if (source === null) return { note: null, source: null };

  if (!isPageCreate) return { note: null, source };

  // Cheap gate before the snapshot boundary: any strictly-safe extractable array?
  let hasExtractable: boolean = false;
  try {
    hasExtractable = analyzeExtractable(source, '').extractions.length > 0;
  } catch (err) {
    logger.info('content-extract.skipped', { appId, filePath: pageRel, reason: getErrorMessage(err) });
  }
  if (!hasExtractable) return { note: null, source };

  const note: string | null = await tryConform(files, appId, appPath, pageRel, source);
  if (note !== null) return { note, source: null };

  // Declined or rolled back — re-read the restored page for the advisory pass.
  try {
    return { note: null, source: await readMaybe(files, pageRel) };
  } catch {
    return { note: null, source: null };
  }
}

/**
 * Snapshot → scaffold → vite-patch → barrel-remove → page-write → validate, with
 * full rollback on any failure. Returns the conformed note, or `null` to fall
 * through to advisory. Never throws — every failure resolves to rollback + null.
 */
async function tryConform(
  files: WorkspaceFiles,
  appId: string,
  appPath: string,
  pageRel: string,
  source: string,
): Promise<string | null> {
  let plan: ExtractionPlan;
  try {
    plan = planPageExtraction(source, pageRel);
  } catch (err) {
    // An unsafe-rewrite throw means nothing was written — nothing to roll back.
    logger.info('content-extract.skipped', { appId, filePath: pageRel, reason: getErrorMessage(err) });
    return null;
  }
  if (plan.extractedNames.length === 0 || !plan.content || !plan.newPageSource) {
    return null;
  }
  const newPageSource: string = plan.newPageSource;

  // Pristine pre-scaffold clone: scaffold mints ids by mutating `plan.content`
  // in place, so comparing on-disk JSON against it later would be circular.
  const expected: Record<string, Record<string, unknown>[]> = JSON.parse(
    JSON.stringify(plan.content),
  ) as Record<string, Record<string, unknown>[]>;

  const contentDir: string = join(appPath, 'src', 'content');
  const pageJson: string = `src/content/pages/${plan.binding}.json`;

  let snapshots: Snapshot[];
  try {
    snapshots = await Promise.all([
      snapshotFile(files, pageRel),
      snapshotFile(files, VITE_CONFIG),
      snapshotFile(files, CONTENT_SCHEMAS),
      snapshotFile(files, pageJson),
      snapshotFile(files, CONTENT_DTS),
      snapshotFile(files, CONTENT_BARREL),
      // scaffold(merge) can rekey positional → id-ref locks in .user-edits.json;
      // snapshot it so rollback restores the user's lock file verbatim.
      snapshotFile(files, CONTENT_USER_EDITS),
    ]);
  } catch (err) {
    logger.warn('content-extract.skipped', { appId, filePath: pageRel, reason: getErrorMessage(err) });
    return null;
  }

  const rollback = async (reason: string): Promise<null> => {
    for (const snap of snapshots) {
      try {
        await restore(files, snap);
      } catch (err) {
        logger.warn('content-extract.rollback.partial', {
          appId,
          filePath: snap.relPath,
          error: getErrorMessage(err),
        });
      }
    }
    logger.warn('content-extract.rolledback', { appId, filePath: pageRel, reason });
    return null;
  };

  try {
    // 1. Write the content layer via scaffold (node:fs carve-out — see header).
    const result: contentScaffold.ScaffoldResult = await contentScaffold.scaffoldContent(contentDir, {
      kind: 'page',
      name: plan.binding,
      content: plan.content,
      mode: 'merge',
    });
    if (!result.ok) {
      return await rollback(`scaffold failed: ${result.error.code}: ${result.error.message}`);
    }

    // 2. Register contentPlugin() in vite.config.ts if missing.
    const viteSource: string | null = await readMaybe(files, VITE_CONFIG);
    if (viteSource === null) {
      return await rollback('vite.config.ts not found');
    }
    const patched: { code: string; modified: boolean } =
      contentScaffold.ensureContentPluginRegistered(viteSource);
    if (patched.modified) {
      await files.write({ path: VITE_CONFIG, content: patched.code });
    }

    // 3. Remove the rogue barrel that bypasses virtual:content, if present.
    try {
      await files.delete({ path: CONTENT_BARREL });
    } catch {
      // absent barrel is fine — delete is best-effort here
    }

    // 4. Write the rewritten page last (atomic at the supervisor layer).
    await files.write({ path: pageRel, content: newPageSource });

    const priorPageJson: string | null =
      snapshots.find((s: Snapshot): boolean => s.relPath === pageJson)?.before ?? null;
    const preExistingArrays: Set<string> = arrayKeys(priorPageJson);

    const failure: string | null = await validateConform({
      files,
      pageRel,
      plan,
      expected,
      preExistingArrays,
    });
    if (failure !== null) {
      return await rollback(failure);
    }

    logger.info('content-extract.applied', {
      appId,
      filePath: pageRel,
      binding: plan.binding,
      extracted: plan.extractedNames,
    });
    return conformedNote(plan);
  } catch (err) {
    return await rollback(`unexpected error: ${getErrorMessage(err)}`);
  }
}

/**
 * Workspace-relative page path. The Workspace API is rooted at the app root, so
 * a `src/pages/*.tsx` path is just `fullPath` minus the `appPath` prefix.
 */
function workspaceRelative(appPath: string, fullPath: string): string {
  const prefix: string = appPath.endsWith('/') ? appPath : `${appPath}/`;
  return fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
}

export interface ScanInput {
  appId: string;
  appPath: string;
  workspaceFactory?: WorkspaceFilesFactory;
}

export interface ScanSummary {
  scanned: number;
  /** Workspace-relative page paths that were actually conformed. */
  conformed: string[];
  skipped: number;
}

/**
 * One-time, per-app, in-session scan: conform every `src/pages/*.tsx` once.
 *
 * The on-create conform only heals pages written via `command === 'create'`.
 * Pages that pre-date the content layer or only ever get incremental edits keep
 * their inline arrays. This closes that gap by running the per-page conform
 * across the whole `src/pages` tree on the first DEVELOP-agent turn.
 *
 * Reuses `conformPageToContentLayer` verbatim (with `isPageCreate: true`, since
 * each existing page is treated like a fresh create for extraction purposes).
 * That entry no-ops already-conformed / non-extractable pages, so this is
 * idempotent by construction — a later conversation's scan is cheap, no extra
 * dedupe needed.
 *
 * Fail-safe at two levels: each page call is wrapped so one page failing never
 * stops the others, and the whole function is wrapped so it never throws.
 */
export async function conformExistingPages(input: ScanInput): Promise<ScanSummary> {
  const { appId, appPath } = input;
  const factory: WorkspaceFilesFactory = input.workspaceFactory ?? createForWorkspace;
  const conformed: string[] = [];
  let scanned: number = 0;
  let skipped: number = 0;

  try {
    const files: WorkspaceFiles | null = resolveFiles(appId, factory);
    if (files === null) {
      logger.info('content-extract.scan.summary', { appId, scanned: 0, conformed: 0, skipped: 0 });
      return { scanned: 0, conformed: [], skipped: 0 };
    }

    const tree: { entries: { path: string; kind: 'file' | 'directory' }[] } = await files.tree({
      path: 'src/pages',
      recursive: true,
      kindFilter: 'file',
    });
    const pages: string[] = tree.entries
      .filter((e: { path: string }): boolean => e.path.endsWith('.tsx'))
      .map((e: { path: string }): string => e.path);

    for (const pageRel of pages) {
      scanned += 1;
      try {
        const outcome: ConformOutcome = await conformPageToContentLayer({
          appId,
          appPath,
          fullPath: join(appPath, pageRel),
          command: 'create',
          isPageCreate: true,
          workspaceFactory: factory,
        });
        if (outcome.note !== null) {
          conformed.push(pageRel);
        } else {
          skipped += 1;
        }
      } catch (err) {
        // Per-page isolation: conformPageToContentLayer is documented never to
        // throw, but belt-and-suspenders so one bad page can't abort the scan.
        skipped += 1;
        logger.warn('content-extract.scan.page-failed', {
          appId,
          filePath: pageRel,
          error: getErrorMessage(err),
        });
      }
    }
  } catch (err) {
    // Whole-scan fail-safe: tree enumeration or anything else failing must not
    // throw into the (fire-and-forget) caller.
    logger.warn('content-extract.scan.failed', { appId, error: getErrorMessage(err) });
  }

  logger.info('content-extract.scan.summary', {
    appId,
    scanned,
    conformed: conformed.length,
    skipped,
  });
  return { scanned, conformed, skipped };
}
