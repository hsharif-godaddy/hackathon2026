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
import path from 'path';
import type { WorkspaceFiles } from '../workspace/files.js';
import { DevSupervisorError } from '../services/DevSupervisorClient.js';

const METHOD_FILES = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiRouteEntry {
  method: string;
  path: string;
  importPath: string;
  methodName: string;
  relDir: string;
}

export async function scanApiDir(files: WorkspaceFiles): Promise<ApiRouteEntry[]> {
  const results: ApiRouteEntry[] = [];
  let tree;
  try {
    tree = await files.tree({ path: 'src/server/api', recursive: true });
  } catch (error) {
    if (error instanceof DevSupervisorError && error.code === 'not_found') {
      return [];
    }
    throw error;
  }

  for (const entry of tree.entries) {
    if (entry.kind !== 'file') continue;
    const ext = path.extname(entry.path);
    if (ext !== '.ts' && ext !== '.js') continue;
    const methodName = path.basename(entry.path, ext);
    if (!METHOD_FILES.has(methodName)) continue;

    // entry.path is relative to app root (e.g. 'src/server/api/health/GET.ts')
    const relToApi = path.relative('src/server/api', path.dirname(entry.path));
    const routePath =
      relToApi === ''
        ? '/'
        : '/' + relToApi.split(path.sep).map((seg) => seg.replace(/^\[(.+)\]$/, ':$1')).join('/');
    const importPath =
      './api/' + (relToApi === '' ? methodName : relToApi.split(path.sep).join('/') + '/' + methodName);

    results.push({
      method: methodName.toLowerCase(),
      path: routePath,
      importPath,
      methodName,
      relDir: relToApi,
    });
  }

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
 */
export async function regenerateEntryApiRegistrations(files: WorkspaceFiles): Promise<RegenerateResult> {
  const [original, entries] = await Promise.all([
    files.readText({ path: 'src/server/entry.ts' }).catch((error: unknown) => {
      if (error instanceof DevSupervisorError && error.code === 'not_found') return null;
      throw error;
    }),
    scanApiDir(files),
  ]);

  if (!original) {
    return { changed: false, reason: 'no-entry', routeCount: 0 };
  }
  if (entries.length === 0) {
    return { changed: false, reason: 'no-api-dir', routeCount: 0 };
  }

  const { imports, registrations } = generateEntryApiBlocks(entries);

  const importBlock = imports
    ? `// <api-imports>\n${imports}\n// </api-imports>`
    : '// <api-imports>\n// </api-imports>';
  const registrationBlock = registrations
    ? `// <api-registrations>\n${registrations}\n// </api-registrations>`
    : '// <api-registrations>\n// </api-registrations>';

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
  await files.write({ path: 'src/server/entry.ts', content });
  return { changed: true, reason: 'rewritten', routeCount: entries.length };
}
