/**
 * Media Slot Usage - Deterministic slot → page mapping via static source analysis.
 *
 * The media grid groups slots into per-page and "Shared" sections. To do that
 * reliably it needs to know, for every page route, which media slots that page
 * renders — and which slots are reused across multiple pages.
 *
 * Slot paths are written as LITERAL strings in the app source (e.g.
 * `slot: '/airo-assets/images/menu/classic-southern'` or
 * `src="/airo-assets/images/menu/sides-spread"`), so this mapping is fully
 * computable from source without rendering anything. For each page file under
 * `src/pages`, we build its transitive local-import closure (following relative
 * and `@/` imports into `src/components`, `src/sections`, etc.) and collect
 * every `/airo-assets/(images|videos)/<slot>` literal reachable from it.
 *
 * The result replaces the old runtime DOM-scan approach, which learned usage
 * lazily one page at a time (causing the grid to visibly re-bucket as the user
 * navigated the preview).
 */

import type { Dirent } from 'node:fs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const PAGES_DIR = join('src', 'pages');
export const SRC_DIR = 'src';

interface CachedUsage {
  result: Record<string, string[]>;
  fingerprint: string;
}

const usageCache = new Map<string, CachedUsage>();

/** Clear cached slot-usage results. Called after source mutations (e.g. split). */
export function clearSlotUsageCache(appPath?: string): void {
  if (appPath) {
    usageCache.delete(appPath);
  } else {
    usageCache.clear();
  }
}

/** Extensions tried when resolving an extension-less import specifier. */
const RESOLVE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;

/** Source files we walk into when building an import closure. */
const SOURCE_FILE_RE = /\.(tsx|ts|jsx|js)$/;

/**
 * Matches a media slot path literal anywhere in source. Captures the slot path
 * after the `/airo-assets/(images|videos)/` prefix, e.g.
 * `/airo-assets/images/menu/classic-southern` → `menu/classic-southern`.
 */
const SLOT_LITERAL_RE = /\/airo-assets\/(?:images|videos)\/([A-Za-z0-9][A-Za-z0-9/_-]*)/g;

/**
 * Matches local import/export-from specifiers and dynamic imports. Node-module
 * specifiers (not starting with `.` or `@/`) are filtered out at resolution.
 */
const IMPORT_SPECIFIER_RE =
  /(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Map a page source file to its route, e.g. `index.tsx` → `/`, `menu.tsx` → `/menu`. */
export function sourcePathToRoute(filePath: string, appPath: string): string {
  const rel = relative(join(appPath, PAGES_DIR), filePath).replace(/\\/g, '/');
  const withoutExt = rel.replace(SOURCE_FILE_RE, '');
  if (withoutExt === 'index') {
    return '/';
  }
  if (withoutExt.endsWith('/index')) {
    return `/${withoutExt.slice(0, -'/index'.length)}`;
  }
  return `/${withoutExt}`;
}

/** Recursively list page source files under `src/pages`. */
export function listPageSourceFiles(appPath: string): string[] {
  const root = join(appPath, PAGES_DIR);
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (SOURCE_FILE_RE.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

/**
 * Resolve a local import specifier to an absolute file path on disk. Returns
 * null for node-module specifiers or unresolved paths. Supports `./`, `../`,
 * and `@/` (→ `src/`) prefixes, extension-less imports, and index files.
 */
export function resolveLocalImport(spec: string, fromFile: string, srcRoot: string): string | null {
  let base: string;
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec);
  } else if (spec.startsWith('@/')) {
    base = resolve(srcRoot, spec.slice(2));
  } else {
    // Bare specifier → node module; not part of the app's source closure.
    return null;
  }

  // Direct file (already has a known extension).
  if (SOURCE_FILE_RE.test(base) && existsSync(base)) {
    return base;
  }
  // Extension-less file.
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  // Directory with an index file.
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const candidate = join(base, `index${ext}`);
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }
  return null;
}

/** Extract local import specifiers referenced by a source file's contents. */
function extractImportSpecifiers(content: string): string[] {
  const specs: string[] = [];
  for (const match of content.matchAll(IMPORT_SPECIFIER_RE)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) {
      specs.push(spec);
    }
  }
  return specs;
}

/** Extract slot paths from a source file's contents, in order of appearance. */
function extractSlotPaths(content: string): string[] {
  const slots: string[] = [];
  for (const match of content.matchAll(SLOT_LITERAL_RE)) {
    const slot = match[1];
    if (slot) {
      // Trim a trailing file extension if the literal pointed at a concrete
      // asset file (slots in the manifest are extension-less paths).
      slots.push(slot.replace(/\.(png|jpe?g|webp|gif|svg|mp4|webm|mov)$/i, ''));
    }
  }
  return slots;
}

/**
 * Collect every slot path reachable from `entryFile` by walking its transitive
 * local-import closure. Slots are returned in deterministic order: the entry
 * file's own slots first (top-to-bottom), then slots from imported modules in
 * import order. Duplicates are removed, keeping first occurrence.
 *
 * `skipImport` lets a caller prune the traversal: when it returns true for a
 * resolved import, that module (and its sub-closure) is not followed. This is
 * used by the global-chrome walk to avoid descending from `App.tsx` into the
 * page route targets it imports, which would otherwise treat every page's slots
 * as sitewide.
 */
function collectSlotsFromClosure(
  entryFile: string,
  srcRoot: string,
  skipImport?: (resolvedFile: string) => boolean
): string[] {
  const ordered: string[] = [];
  const seenSlots = new Set<string>();
  const visited = new Set<string>();

  const visit = (file: string) => {
    if (visited.has(file)) {
      return;
    }
    visited.add(file);

    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      return;
    }

    for (const slot of extractSlotPaths(content)) {
      if (!seenSlots.has(slot)) {
        seenSlots.add(slot);
        ordered.push(slot);
      }
    }

    for (const spec of extractImportSpecifiers(content)) {
      const resolved = resolveLocalImport(spec, file, srcRoot);
      if (resolved && !skipImport?.(resolved)) {
        visit(resolved);
      }
    }
  };

  visit(entryFile);
  return ordered;
}

/**
 * Compute the slot closure for the app's global layout chrome (header, footer,
 * nav, etc.). These slots — logos especially — render on every page, so they are
 * merged into each route's usage. Entry points are every file under
 * `src/layouts` plus a top-level `src/App.*` if present.
 */
function collectGlobalSlots(srcRoot: string): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const entryPoints: string[] = [];
  const layoutsDir = join(srcRoot, 'layouts');
  if (existsSync(layoutsDir) && statSync(layoutsDir).isDirectory()) {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (SOURCE_FILE_RE.test(entry.name)) {
          entryPoints.push(full);
        }
      }
    };
    walk(layoutsDir);
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const appFile = join(srcRoot, `App${ext}`);
    if (existsSync(appFile)) {
      entryPoints.push(appFile);
    }
  }

  // Page route targets (`src/pages/**`) are NOT global chrome: a page's slots
  // belong to that page only. `App.tsx` imports every page (it is the router),
  // so without this guard the global closure would absorb every slot in the app
  // and mark them all sitewide.
  const pagesRoot = join(srcRoot, 'pages');
  const isPageFile = (file: string) => {
    const rel = relative(pagesRoot, file);
    return rel !== '' && !rel.startsWith('..');
  };

  for (const entry of entryPoints) {
    for (const slot of collectSlotsFromClosure(entry, srcRoot, isPageFile)) {
      if (!seen.has(slot)) {
        seen.add(slot);
        ordered.push(slot);
      }
    }
  }
  return ordered;
}

/**
 * Cheap content-aware fingerprint of an app's source tree: the source-file
 * count combined with the newest mtime under `src`. Unlike a wall-clock TTL,
 * this invalidates the cache the instant a build/commit adds, edits, or removes
 * a source file — so newly built pages are never masked by a stale cache — while
 * still skipping the expensive read+parse pass when nothing changed. Statting
 * files is far cheaper than reading and analyzing them, so this stays light.
 */
function computeSourceFingerprint(appPath: string): string {
  const srcRoot = join(appPath, SRC_DIR);
  if (!existsSync(srcRoot)) {
    return '0:0';
  }
  let fileCount = 0;
  let newestMtimeMs = 0;
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!SOURCE_FILE_RE.test(entry.name)) {
        continue;
      }
      try {
        const { mtimeMs } = statSync(full);
        fileCount += 1;
        if (mtimeMs > newestMtimeMs) {
          newestMtimeMs = mtimeMs;
        }
      } catch {
        // File vanished mid-walk; ignore.
      }
    }
  };
  walk(srcRoot);
  return `${fileCount}:${newestMtimeMs}`;
}

/**
 * Compute a deterministic `route → slot[]` map for an app by statically
 * analyzing each page's import closure. Routes are page routes under
 * `src/pages`; slot lists are ordered by source appearance. Slots rendered by
 * the global layout chrome (e.g. header/footer logos) are appended to every
 * route, since they appear on every page.
 */
export function computeSlotUsageByRoute(appPath: string): Record<string, string[]> {
  const fingerprint = computeSourceFingerprint(appPath);
  const cached = usageCache.get(appPath);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.result;
  }

  const srcRoot = join(appPath, SRC_DIR);
  const usageByRoute: Record<string, string[]> = {};
  const globalSlots = collectGlobalSlots(srcRoot);

  for (const file of listPageSourceFiles(appPath)) {
    const route = sourcePathToRoute(file, appPath);
    // Skip the not-found page (`404.tsx` → `/404`, `_404.tsx` → `/_404`).
    if (route === '/404' || route === '/_404') {
      continue;
    }
    const pageSlots = collectSlotsFromClosure(file, srcRoot);
    const seen = new Set(pageSlots);
    const merged = [...pageSlots];
    for (const slot of globalSlots) {
      if (!seen.has(slot)) {
        seen.add(slot);
        merged.push(slot);
      }
    }
    if (merged.length > 0) {
      usageByRoute[route] = merged;
    }
  }

  usageCache.set(appPath, { result: usageByRoute, fingerprint });
  return usageByRoute;
}
