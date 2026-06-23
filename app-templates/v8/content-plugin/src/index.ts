import type { Plugin } from 'vite';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { parseJson } from './parse';

const VIRTUAL_ID = 'virtual:content';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

function directImportError(rel: string): Error {
  return new Error(
    `[airo-content] Direct import of ${rel} is forbidden. ` +
    `Content files under src/content/ must be consumed through the ` +
    `virtual module:\n\n` +
    `  import { <key> } from 'virtual:content';\n\n` +
    `See src/content/virtual-content.d.ts for available keys.`,
  );
}

interface Options {
  contentDir?: string;
}

interface Entry {
  key: string;
  absPath: string;
}

/**
 * Emits a virtual `virtual:content` module whose exports are the parsed content
 * of `src/content/**`, validated at module-eval time against schemas exported
 * from `src/content/schemas.ts`.
 *
 * Discovery rules (v1, JSON-only):
 *   src/content/site.json           → `site`
 *   src/content/pages/<name>.json   → `<name>` (page-level)
 *   src/content/data/<name>.json    → `<name>` (data collection)
 */
export function contentPlugin(options: Options = {}): Plugin {
  const relContentDir = options.contentDir ?? 'src/content';
  let projectRoot: string;
  let contentDir: string;
  let schemasImportPath: string;

  return {
    name: 'airo-content',
    // `enforce: 'pre'` gives us resolveId priority over Vite's built-in JSON
    // plugin, so we can block direct .json imports under src/content/ before
    // Vite serves the file.
    enforce: 'pre',

    configResolved(config) {
      projectRoot = config.root;
      contentDir = path.resolve(config.root, relContentDir);
      schemasImportPath = '/' + path.posix.join(relContentDir, 'schemas');
    },

    configureServer(s) {
      // Register the reload handlers UNCONDITIONALLY. Vite's dev-server watcher
      // already covers the project root, so a `src/content/` that appears AFTER
      // the server boots — an agent scaffolding the content layer mid-session,
      // or the first content edit — still hot-reloads. Returning early when the
      // dir was absent at boot (skipping these handlers) was a bug: late-created
      // content never invalidated the cached `virtual:content` module.
      //
      // On content file change: reload just the virtual:content module and
      // let Vite's HMR propagate through its importers (the React plugin
      // injects `import.meta.hot.accept` in component files, so React Fast
      // Refresh re-renders in place — no full page reload, no flash).
      const invalidate = (file: string, event: string) => {
        if (!file.startsWith(contentDir)) return;
        s.config.logger.info(`[airo-content] ${event}: ${path.relative(projectRoot, file)}`);
        const mod = s.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
        if (!mod) {
          s.config.logger.info(`[airo-content] virtual:content not yet in module graph — skipping reload`);
          return;
        }
        void s.reloadModule(mod)
          .then(() => {
            s.config.logger.info(`[airo-content] reloaded virtual:content (HMR propagating)`);
          })
          .catch((err) => {
            s.config.logger.error(
              `[airo-content] HMR reload failed for virtual:content: ${String(err)}`,
              { error: err as Error },
            );
            try {
              s.ws.send({ type: 'full-reload', path: '*' });
            } catch {
              // dev server shutting down
            }
          });
      };
      s.watcher.on('change', (f) => invalidate(f, 'change'));
      s.watcher.on('add', (f) => invalidate(f, 'add'));
      s.watcher.on('unlink', (f) => invalidate(f, 'unlink'));

      if (!existsSync(contentDir)) {
        s.config.logger.info(`[airo-content] no ${relContentDir}/ yet — watcher armed, awaiting content`);
        return;
      }
      s.watcher.add(contentDir);

      // Eager schema validation: evaluate schemas.ts and validate every
      // discovered content file at dev-server start. Mismatches surface in
      // dev-server stderr rather than the browser's runtime console — which
      // is the channel agents read (`agents/dev.log`) for self-correction.
      void validateContentEager(s, contentDir, schemasImportPath).catch((err) => {
        s.config.logger.error(String(err), { error: err as Error });
      });
    },

    resolveId(source, importer) {
      if (source === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;

      // The virtual module's own import of schemas.ts must pass through.
      if (importer === RESOLVED_VIRTUAL_ID) return undefined;

      // Block ALL direct imports that resolve under src/content/. The CMS
      // contract is that content is only consumed through `virtual:content`;
      // any direct import (JSON, barrel .ts re-exports, etc.) bypasses schema
      // validation and source-mapper attribution, silently breaking inline
      // editing. Rejecting loudly is the fix.
      const cleanSource = source.replace(/[?#].*$/, '');

      const resolved = resolveAbsolute(cleanSource, importer, projectRoot);
      if (!resolved) return undefined;

      if (
        (resolved === contentDir || resolved.startsWith(contentDir + path.sep)) &&
        !isContentMetaModule(resolved, contentDir)
      ) {
        throw directImportError(path.relative(path.dirname(contentDir), resolved));
      }

      return undefined;
    },

    async load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        const entries = await discover(contentDir);
        const schemasPath = path.join(contentDir, 'schemas.ts');
        return emitVirtualModule(entries, schemasImportPath, schemasPath);
      }

      // Guard against alias-resolved imports (e.g. @/content → src/content/index.ts).
      // resolveId can't catch bare specifiers; this load hook sees the resolved path.
      const cleanId = id.replace(/[?#].*$/, '');
      if (
        (cleanId === contentDir || cleanId.startsWith(contentDir + path.sep)) &&
        !isContentMetaModule(cleanId, contentDir)
      ) {
        throw directImportError(path.relative(path.dirname(contentDir), cleanId));
      }

      return undefined;
    },
  };
}

export default contentPlugin;

async function discover(contentDir: string): Promise<Entry[]> {
  const entries: Entry[] = [];

  // Enforce layout: the ONLY JSON allowed at the content-dir top level is
  // site.json. Page content belongs under pages/; data collections under
  // data/. Agents sometimes default to writing `src/content/<name>.json` —
  // failing loudly here points them at the right subdirectory.
  if (await exists(contentDir)) {
    for (const entry of await fs.readdir(contentDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      // Ignore dotfiles (e.g. `.user-edits.json`, the CMS user-edit provenance
      // record, and any future metadata dotfile) — they are sidecars, not
      // content, so they must not trip the layout validator.
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'site.json') continue;
      throw new Error(
        `[airo-content] Unexpected file src/content/${entry.name}.\n` +
        `Page content belongs at src/content/pages/${entry.name}.\n` +
        `Data collections belong at src/content/data/${entry.name}.\n` +
        `The only JSON allowed directly at src/content/ is site.json.`,
      );
    }
  }

  const site = path.join(contentDir, 'site.json');
  if (await exists(site)) {
    entries.push({ key: 'site', absPath: site });
  }

  for (const subdir of ['pages', 'data']) {
    const dir = path.join(contentDir, subdir);
    if (!(await exists(dir))) continue;
    for (const file of await fs.readdir(dir)) {
      if (!file.endsWith('.json')) continue;
      const key = file.replace(/\.json$/, '');
      assertSafeKey(key, file);
      entries.push({ key, absPath: path.join(dir, file) });
    }
  }

  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.key)) {
      throw new Error(`[airo-content] duplicate content key "${e.key}" — defined by more than one file`);
    }
    seen.add(e.key);
  }

  return entries;
}

async function emitVirtualModule(
  entries: Entry[],
  schemasImportPath: string,
  schemasPath: string,
): Promise<string> {
  const hasSchemas = await exists(schemasPath);
  const lines: string[] = [];

  if (hasSchemas) {
    lines.push(`import { schemas } from '${schemasImportPath}';`);
    lines.push(`const identity = { parse: (v) => v };`);
  }
  lines.push('');

  for (const entry of entries) {
    const raw = await fs.readFile(entry.absPath, 'utf8');
    let value: unknown;
    try {
      value = parseJson(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[airo-content] failed to parse ${entry.absPath}: ${msg}`);
    }

    const literal = JSON.stringify(value, null, 2);
    if (hasSchemas) {
      lines.push(`export const ${entry.key} = (schemas.${entry.key} ?? identity).parse(${literal});`);
    } else {
      lines.push(`export const ${entry.key} = ${literal};`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Evaluate `schemas.ts` via the dev server's SSR module loader and validate
 * every discovered content file against its matching schema. Any Zod parse
 * error is rethrown with the file path prefixed so dev-server stderr shows
 * exactly which file is wrong.
 *
 * Exported for testability. Callers inject a loader that mimics Vite's
 * `server.ssrLoadModule` signature so tests don't need a live server.
 */
export async function validateContentEager(
  server: {
    ssrLoadModule: (url: string) => Promise<Record<string, unknown>>;
  },
  contentDir: string,
  schemasImportPath: string,
): Promise<void> {
  const schemasPath = path.join(contentDir, 'schemas.ts');
  if (!(await exists(schemasPath))) {
    // Schemas are optional — no file means no validation, matching the
    // pass-through behavior of the existing load() hook.
    return;
  }

  let mod: Record<string, unknown>;
  try {
    mod = await server.ssrLoadModule(schemasImportPath);
  } catch (err) {
    throw new Error(
      `[airo-content] failed to evaluate ${schemasPath}: ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const schemas = mod.schemas as Record<string, { parse: (v: unknown) => unknown } | undefined> | undefined;
  if (!schemas || typeof schemas !== 'object') {
    // schemas.ts exists but doesn't export `schemas` — skip gracefully so
    // users can scaffold incrementally without blocking dev-server start.
    return;
  }

  const entries = await discover(contentDir);
  for (const entry of entries) {
    const raw = await fs.readFile(entry.absPath, 'utf8');
    let value: unknown;
    try {
      value = parseJson(raw);
    } catch (err) {
      throw new Error(
        `[airo-content] failed to parse ${entry.absPath}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const schema = schemas[entry.key];
    if (!schema) continue; // unregistered key — pass-through
    if (typeof schema.parse !== 'function') continue; // non-Zod export — skip silently

    try {
      schema.parse(value);
    } catch (err) {
      throw new Error(
        `[airo-content] content in ${entry.absPath} does not match schemas.${entry.key}:\n` +
        (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}

/**
 * Best-effort resolution of a Vite `resolveId` source string to an absolute
 * filesystem path. Handles absolute paths, relative paths from an importer,
 * and Vite's convention where a leading `/` means project-root-relative.
 *
 * Returns undefined for unresolvable sources (bare specifiers, node:*, etc.);
 * callers should treat undefined as "not our concern."
 */
function resolveAbsolute(
  source: string,
  importer: string | undefined,
  projectRoot: string,
): string | undefined {
  // Strip query/hash (Vite uses `?raw`, `?url`, etc. as suffixes)
  const clean = source.replace(/[?#].*$/, '');

  // On POSIX a leading `/` makes isAbsolute() true. Vite also treats
  // leading-`/` sources as project-root-relative inside some transform
  // contexts. Rather than guess which convention applies, try both and
  // return whichever lands inside the project tree first.
  if (clean.startsWith('/')) {
    const osAbs = clean; // treat as already-absolute
    const rootRel = path.resolve(projectRoot, clean.slice(1));
    // If the OS-absolute interpretation doesn't live under projectRoot,
    // prefer the project-root-relative interpretation — the only way a
    // leading-`/` import resolves under projectRoot is either via an OS
    // path that already happens to sit there (the alias-resolved case) or
    // via Vite's root-relative convention (the "/src/..." case).
    return osAbs.startsWith(projectRoot + path.sep) ? osAbs : rootRel;
  }

  if (clean.startsWith('./') || clean.startsWith('../')) {
    if (!importer) return undefined;
    return path.resolve(path.dirname(importer), clean);
  }
  return undefined;
}

/**
 * Files under contentDir that are META, not content data, so the direct-import
 * guard must let them through:
 *  - the Zod `schemas` module — imported by the virtual module + the eager
 *    validator (`validateContentEager` via `ssrLoadModule`). The two hooks see
 *    it differently: `resolveId` gets the extensionless project-root-relative
 *    path (`/src/content/schemas`), `load` gets the resolved id (`.../schemas.ts`).
 *  - any type-declaration file (`*.d.ts`, e.g. the generated `virtual-content.d.ts`
 *    that `content_scaffold` emits into contentDir) — type-only, never a runtime
 *    import, so blocking it is always wrong.
 * Match by the contentDir-relative name so neither hook blocks them.
 */
function isContentMetaModule(resolvedPath: string, contentDir: string): boolean {
  const rel = path.relative(contentDir, resolvedPath);
  return rel === 'schemas' || rel === 'schemas.ts' || rel.endsWith('.d.ts');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return false;
  }
}

// JS reserved words and strict-mode future reserved words that would produce
// invalid `export const <key> = …` syntax if used as content keys.
const JS_RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'let', 'new', 'null', 'return', 'static', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield', 'enum', 'await',
]);

function assertSafeKey(key: string, filename: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
    throw new Error(`[airo-content] invalid content key "${key}" from "${filename}" — must be a valid JS identifier`);
  }
  if (JS_RESERVED_WORDS.has(key)) {
    throw new Error(
      `[airo-content] reserved content key "${key}" from "${filename}" — ` +
      `"${key}" is a JS reserved word and cannot be used as an export name. ` +
      `Rename the file to avoid a syntax error in the emitted virtual module.`,
    );
  }
}
