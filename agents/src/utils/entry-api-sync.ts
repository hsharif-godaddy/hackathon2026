/**
 * Regenerates Express route imports and app.METHOD(...) registrations
 * in an app's src/server/entry.ts based on the files under src/server/api/**.
 *
 * Used after skill installation so API routes shipped by a skill are actually
 * wired up without waiting for the preview container's template sync migration.
 *
 * Logic mirrors container-scripts/preview/sync-template-files.js
 * (scanApiDir / sortRoutes / generateEntryApiBlocks / migrate-to-ssr-entry).
 */
import { promises as fs } from 'fs';
import path from 'path';

const METHOD_FILES = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiRouteEntry {
  method: string;
  path: string;
  importPath: string;
  methodName: string;
  relDir: string;
}

async function walk(dir: string, apiDir: string, out: ApiRouteEntry[]): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    // Only swallow missing-directory; an EACCES or EIO on a subtree would
    // otherwise silently omit API routes and the regenerated entry.ts
    // would 404 them. Propagate so the caller surfaces the failure.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const name of names) {
    // dir is rooted at apiDir (a trusted app directory supplied by the
    // skill installer), name comes from fs.readdir of that directory —
    // not user input. Semgrep's path-traversal rule fires on the
    // signature but there is no attacker-controlled input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const full = path.join(dir, name);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(full);
    } catch (err) {
      // Entry was deleted between readdir and stat. Skip silently; other
      // errors (EACCES, EIO) propagate so the caller doesn't overwrite
      // entry.ts with fewer registrations than the tree actually has.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    if (stat.isDirectory()) {
      await walk(full, apiDir, out);
      continue;
    }
    const ext = path.extname(name);
    if (ext !== '.ts' && ext !== '.js') continue;
    const methodName = path.basename(name, ext);
    if (!METHOD_FILES.has(methodName)) continue;

    const relDir = path.relative(apiDir, path.dirname(full));
    const routePath =
      relDir === ''
        ? '/'
        : '/' + relDir.split(path.sep).map((seg) => seg.replace(/^\[(.+)\]$/, ':$1')).join('/');
    const importPath =
      './api/' + (relDir === '' ? methodName : relDir.split(path.sep).join('/') + '/' + methodName);

    out.push({
      method: methodName.toLowerCase(),
      path: routePath,
      importPath,
      methodName,
      relDir,
    });
  }
}

export async function scanApiDir(apiDir: string): Promise<ApiRouteEntry[]> {
  const results: ApiRouteEntry[] = [];
  await walk(apiDir, apiDir, results);
  return sortRoutes(results);
}

export function sortRoutes(routes: ApiRouteEntry[]): ApiRouteEntry[] {
  return routes.sort((a, b) => {
    const aParts = a.path.split('/').filter(Boolean);
    const bParts = b.path.split('/').filter(Boolean);
    const len = Math.min(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
      const aSeg = aParts[i] ?? '';
      const bSeg = bParts[i] ?? '';
      const aIsParam = aSeg.startsWith(':');
      const bIsParam = bSeg.startsWith(':');
      if (aIsParam !== bIsParam) return aIsParam ? 1 : -1;
      const cmp = aSeg.localeCompare(bSeg);
      if (cmp !== 0) return cmp;
    }
    if (aParts.length !== bParts.length) return aParts.length - bParts.length;
    return a.method.localeCompare(b.method);
  });
}

function identifierFor(entry: ApiRouteEntry, index: number): string {
  const parts = entry.relDir === '' ? [] : entry.relDir.split(path.sep);
  parts.push(entry.methodName.toLowerCase());
  const base = parts
    .map((s) => s.replace(/^\[(.+)\]$/, '$1').replace(/[^a-zA-Z0-9]/g, '_'))
    .join('_');
  // Underscore-prefix when the base starts with a digit — JS identifiers
  // cannot start with a digit, so an API dir like src/server/api/2026/GET.ts
  // would otherwise emit `import 2026_get_0` and break the bundle parse.
  const safeBase = /^[0-9]/.test(base) ? `_${base}` : base;
  return `${safeBase || 'route'}_${index}`;
}

export interface EntryApiBlocks {
  imports: string;
  registrations: string;
}

export function generateEntryApiBlocks(entries: ApiRouteEntry[]): EntryApiBlocks {
  if (entries.length === 0) {
    return { imports: '', registrations: '' };
  }
  const imports = entries
    .map((e, i) => `import ${identifierFor(e, i)} from ${JSON.stringify(e.importPath)};`)
    .join('\n');
  const registrations = entries
    .map(
      (e, i) =>
        `app.${e.method}(${JSON.stringify('/api' + (e.path === '/' ? '' : e.path))}, ${identifierFor(e, i)});`,
    )
    .join('\n');
  return { imports, registrations };
}

export interface RegenerateResult {
  changed: boolean;
  reason: 'no-entry' | 'no-api-dir' | 'markers-missing' | 'rewritten' | 'no-change';
  routeCount: number;
}

/**
 * Rescans src/server/api/** and rewrites the API import block + registrations
 * in src/server/entry.ts.
 *
 * Recognizes two shapes of entry.ts to rewrite:
 *   a) The bare v8 template (just `healthGet` import + registration) - first install
 *   b) A previously generated block marked with // <api-imports> / // </api-imports>
 *      (and the matching registration markers) - subsequent re-syncs
 *
 * If neither shape is found, returns { changed: false, reason: 'markers-missing' }
 * and leaves entry.ts untouched so a customer-customized entry is not corrupted.
 */
export async function regenerateEntryApiRegistrations(appPath: string): Promise<RegenerateResult> {
  // appPath is the customer app directory supplied by the skill installer
  // (derived from the platform-managed per-app workspace), not user input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const entryPath = path.join(appPath, 'src/server/entry.ts');
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const apiDir = path.join(appPath, 'src/server/api');

  // ENOENT-narrowed catches mirror walk() above: an EACCES/EIO on entryPath
  // or apiDir must not be silently treated as "not installed" - that would
  // make the skill installer believe the file doesn't exist and skip
  // regeneration, dropping real API routes from the entry.ts it emits.
  try {
    await fs.access(entryPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { changed: false, reason: 'no-entry', routeCount: 0 };
    }
    throw err;
  }
  try {
    await fs.access(apiDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { changed: false, reason: 'no-api-dir', routeCount: 0 };
    }
    throw err;
  }

  const entries = await scanApiDir(apiDir);
  const { imports, registrations } = generateEntryApiBlocks(entries);

  const importBlock = imports
    ? `// <api-imports>\n${imports}\n// </api-imports>`
    : '// <api-imports>\n// </api-imports>';
  const registrationBlock = registrations
    ? `// <api-registrations>\n${registrations}\n// </api-registrations>`
    : '// <api-registrations>\n// </api-registrations>';

  const original = await fs.readFile(entryPath, 'utf8');
  let content = original;

  const importMarkerRe = /\/\/ <api-imports>[\s\S]*?\/\/ <\/api-imports>/;
  const regMarkerRe = /\/\/ <api-registrations>[\s\S]*?\/\/ <\/api-registrations>/;
  const bareImportRe = /import healthGet from "\.\/api\/health\/GET";/;
  const bareRegRe = /app\.get\("\/api\/health", healthGet\);/;

  if (importMarkerRe.test(content) && regMarkerRe.test(content)) {
    content = content.replace(importMarkerRe, importBlock);
    content = content.replace(regMarkerRe, registrationBlock);
  } else if (bareImportRe.test(content) && bareRegRe.test(content)) {
    content = content.replace(bareImportRe, importBlock);
    content = content.replace(bareRegRe, registrationBlock);
  } else {
    return { changed: false, reason: 'markers-missing', routeCount: entries.length };
  }

  if (content === original) {
    return { changed: false, reason: 'no-change', routeCount: entries.length };
  }
  await fs.writeFile(entryPath, content, 'utf8');
  return { changed: true, reason: 'rewritten', routeCount: entries.length };
}
