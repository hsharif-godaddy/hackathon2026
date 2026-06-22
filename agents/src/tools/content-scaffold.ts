import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { parse as babelParse } from '@babel/parser';
import babelGenerate from '@babel/generator';
import * as t from '@babel/types';
import { atomicWrite, fileExists } from '../utils/fs-utils.js';
import { getErrorMessage } from '../utils/error.js';
import { parseContentKey, isIdRef, type ContentPathSegment } from './content-editor.js';
import { readUserLocks, writeUserLocks } from './content-user-edits.js';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'content-scaffold' });

// Babel generator's default-export has a CJS interop quirk under ESM bundlers.

const generate: any = (babelGenerate as any).default ?? babelGenerate;

export type ScaffoldKind = 'page' | 'collection' | 'site';

export interface ScaffoldRequest {
  kind: ScaffoldKind;
  /**
   * Content-root name. Ignored for `kind: 'site'` (singleton). Must match a
   * valid lowercase-JS-identifier pattern to avoid collisions with the Vite
   * virtual-module export rules.
   */
  name?: string;
  /** Initial content object; schema is inferred from this shape. */
  content: unknown;
  /**
   * Reconciliation policy when an existing content file is present:
   *   - `merge` (default): replace-except-user-locked — incoming content is the
   *     new default, but values at user-locked paths are preserved from disk.
   *   - `replace`: write incoming content verbatim, ignoring any user locks.
   */
  mode?: 'merge' | 'replace';
}

export type ScaffoldErrorCode =
  | 'invalid-name'
  | 'invalid-kind'
  | 'cannot-infer-schema'
  | 'schemas-parse-failed'
  | 'schemas-shape-unsupported'
  | 'read-failed'
  | 'write-failed';

export interface ScaffoldError {
  code: ScaffoldErrorCode;
  message: string;
}

export interface ScaffoldSuccess {
  ok: true;
  /** Absolute path of the written content file. */
  file: string;
  /** Relative path to the content file from the app root. */
  relFile: string;
  /** Canonical `virtual:content` import line the agent should use in JSX. */
  importLine: string;
  /** Whether schemas.ts was created (true) or patched in place (false). */
  schemasCreated: boolean;
  /** The content key that was registered (e.g., "home", "products", "site"). */
  key: string;
}

export type ScaffoldResult = ScaffoldSuccess | { ok: false; error: ScaffoldError };

const NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const SITE_KEY = 'site';
const INITIAL_SCHEMAS_TS = `import { z } from 'zod';

export const schemas = {};

export type Schemas = typeof schemas;
`;

/**
 * Scaffold a content root atomically: resolve file path from kind+name,
 * infer a Zod schema from the content shape, patch schemas.ts to register
 * it, and write the JSON content file.
 *
 * Reconciliation: in the default `merge` mode, an existing file's
 * user-locked values (recorded in `.user-edits.json`) win over the incoming
 * content; everything else is replaced. `mode: 'replace'` writes the
 * incoming content verbatim. The schema is always inferred from the final
 * (merged) shape so newly-added fields are registered.
 *
 * Exported helper functions are individually testable; the top-level
 * orchestrator glues them together.
 */
/**
 * Normalize an incoming `content` value. Agents often pass a stringified-JSON
 * blob instead of a structured value; if `content` is a string that parses to
 * an object or array, return the parsed structure. Anything else (a real
 * object/array, a non-JSON string, or a JSON primitive) is returned unchanged —
 * we only promote the structural cases the content layer cares about.
 */
export function normalizeContent(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed !== null && typeof parsed === 'object') return parsed;
  } catch {
    // Not JSON — a legitimate plain string value; leave it as-is.
  }
  return content;
}

function isPlainObjectValue(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Mint a stable, url-safe, collision-resistant item id. Uses the repo-standard
 * `nanoid` (default 21-char alphabet is `[A-Za-z0-9_-]`, matching the `[@id]`
 * lock-key charset) so a minted id is always a valid id-anchored path segment.
 */
function mintItemId(): string {
  return nanoid();
}

/**
 * Walk a JSON-compatible value in place. Every object that is an element of an
 * array gets a string `id` minted if it lacks one. Existing ids are preserved.
 * Idempotent. This is the single enforcement point for collection identity —
 * generation and lazy migration both flow through it.
 */
export function ensureCollectionIds(value: unknown): void {
  if (Array.isArray(value)) {
    for (const el of value) {
      if (isPlainObjectValue(el) && typeof el.id !== 'string') {
        el.id = mintItemId();
      }
      ensureCollectionIds(el);
    }
    return;
  }
  if (isPlainObjectValue(value)) {
    for (const v of Object.values(value)) ensureCollectionIds(v);
  }
}

/**
 * Before minting, let id-less incoming collection items adopt the existing
 * item's id at the same position, so identity is stable across re-scaffolds
 * (a user's inline edit stays anchored to its item even when the agent
 * regenerates the page without echoing ids). Items beyond the existing
 * array's length, or whose existing counterpart has no id, are left for
 * `ensureCollectionIds` to mint fresh. Mutates `incoming` in place; pure
 * otherwise; never throws.
 *
 * INVARIANT: adoption is strictly by position, so it is only correct while
 * `incoming` preserves the existing item order. If `incoming` inserts/removes/
 * reorders items, `incoming[i]` would adopt the wrong neighbor's id and a lock
 * could migrate to the wrong item. This slice has no reorder UI and the agent
 * is prompted to echo ids back on re-scaffold, so order is preserved in
 * practice — but that is a prompt-enforced contract, not a code guarantee. The
 * S4b/c mutation path (which DOES reorder) must reconcile by id, not position.
 */
export function inheritExistingIds(existing: unknown, incoming: unknown): void {
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    for (let i = 0; i < incoming.length; i++) {
      // by-position pairing — safe only when incoming preserves existing order
      const inc = incoming[i];
      const exist = existing[i];
      if (isPlainObjectValue(inc) && typeof inc.id !== 'string') {
        if (isPlainObjectValue(exist) && typeof exist.id === 'string') {
          inc.id = exist.id;
        }
      }
      // recurse pairwise (exist may be undefined → recursion no-ops)
      inheritExistingIds(exist, inc);
    }
    return;
  }
  if (isPlainObjectValue(existing) && isPlainObjectValue(incoming)) {
    for (const [k, v] of Object.entries(incoming)) {
      inheritExistingIds(existing[k], v);
    }
  }
}

/**
 * Defense-in-depth check that every array-of-objects element carries a unique
 * string `id`. Since `ensureCollectionIds` mints an id for every id-less
 * element, this should never report issues — a non-empty result signals a
 * regression in minting (or a direct JSON write that bypassed the tool). Pure;
 * never throws.
 */
export function validateCollectionIds(value: unknown, pathPrefix: string = ''): string[] {
  const issues: string[] = [];
  if (Array.isArray(value)) {
    const objects = value.filter(isPlainObjectValue);
    if (objects.length > 0) {
      const seen = new Set<string>();
      value.forEach((el, i) => {
        if (!isPlainObjectValue(el)) return;
        const id = el.id;
        const at = `${pathPrefix}[${i}]`;
        if (typeof id !== 'string') {
          issues.push(`item at ${at} is missing a string id`);
        } else if (seen.has(id)) {
          issues.push(`duplicate id "${id}" at ${at}`);
        } else {
          seen.add(id);
        }
      });
    }
    value.forEach((el, i) => issues.push(...validateCollectionIds(el, `${pathPrefix}[${i}]`)));
    return issues;
  }
  if (isPlainObjectValue(value)) {
    for (const [k, v] of Object.entries(value)) {
      issues.push(...validateCollectionIds(v, pathPrefix ? `${pathPrefix}.${k}` : k));
    }
  }
  return issues;
}

export async function scaffoldContent(
  contentDir: string,
  req: ScaffoldRequest,
): Promise<ScaffoldResult> {
  const keyOrError = resolveKey(req.kind, req.name);
  if (typeof keyOrError !== 'string') return { ok: false, error: keyOrError };
  const key = keyOrError;

  const file = resolveFilePath(contentDir, req.kind, key);

  // Agents frequently emit `content` as a stringified-JSON blob. Parse it back
  // to structure so we write a real object/array file and infer a matching
  // schema — not a quoted string + z.string() stub.
  const incoming = normalizeContent(req.content);

  let finalContent: unknown = incoming;
  if (req.mode !== 'replace' && (await fileExists(file))) {
    let existing: unknown;
    try {
      existing = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      return {
        ok: false,
        error: { code: 'read-failed', message: `could not read existing content: ${getErrorMessage(err)}` },
      };
    }
    // Inherit ids from existing items before minting so re-scaffolds without
    // ids don't break id-anchored locks.
    inheritExistingIds(existing, incoming);
    ensureCollectionIds(incoming);
    let lockedKeys: string[];
    try {
      lockedKeys = await readUserLocks(contentDir);
    } catch (err) {
      // A transient lock-read failure must not silently drop user locks — that
      // would overwrite user-edited content. Bail before any write.
      return {
        ok: false,
        error: { code: 'read-failed', message: `could not read user locks: ${getErrorMessage(err)}` },
      };
    }
    const rekeyed = rekeyPositionalLocks(existing, lockedKeys, key);
    if (rekeyed.some((k, i) => k !== lockedKeys[i])) {
      // Best-effort (matches recordUserLock): writeUserLocks logs + returns false
      // on failure, which we intentionally ignore. In-memory lockedKeys advances
      // to the rekeyed form for this merge even if the on-disk file kept the old
      // positional keys; the next scaffold self-heals, and there is no reorder
      // path this slice that would make a stale on-disk key dangerous.
      await writeUserLocks(contentDir, rekeyed); // bulk overwrite; lazy migration
      lockedKeys = rekeyed;
    }
    finalContent = applyLocks(existing, incoming, lockedKeys, key);
  } else {
    ensureCollectionIds(incoming);
  }

  ensureCollectionIds(finalContent); // merge may have re-introduced id-less defaults
  const idIssues = validateCollectionIds(finalContent);
  if (idIssues.length > 0) {
    logger.warn('content.scaffold.idValidation.failed', { key, issueCount: idIssues.length, issues: idIssues.slice(0, 5) });
  }

  let zodCode: string;
  try {
    zodCode = inferZodSchema(finalContent);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'cannot-infer-schema',
        message: getErrorMessage(err),
      },
    };
  }

  const schemasPath = path.join(contentDir, 'schemas.ts');
  const schemasCreated = !(await fileExists(schemasPath));
  let existingSchemasSource: string;
  if (schemasCreated) {
    existingSchemasSource = INITIAL_SCHEMAS_TS;
  } else {
    try {
      existingSchemasSource = await fs.readFile(schemasPath, 'utf8');
    } catch (err) {
      return { ok: false, error: { code: 'read-failed' as const, message: `could not read schemas.ts: ${getErrorMessage(err)}` } };
    }
  }

  let patchedSchemas: string;
  try {
    patchedSchemas = patchSchemasFile(existingSchemasSource, key, zodCode);
  } catch (err) {
    const msg = getErrorMessage(err);
    const code = msg.includes('object literal') ? 'schemas-shape-unsupported' : 'schemas-parse-failed';
    return { ok: false, error: { code, message: msg } };
  }

  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Write JSON first — if it fails, schemas.ts is untouched.
    await atomicWrite(file, JSON.stringify(finalContent, null, 2) + '\n');
    await atomicWrite(schemasPath, patchedSchemas);
  } catch (err) {
    return {
      ok: false,
      error: { code: 'write-failed', message: getErrorMessage(err) },
    };
  }

  try {
    await emitVirtualContentDts(contentDir);
  } catch (err) {
    logger.warn('content.scaffold.dtsEmit.failed', { key, error: getErrorMessage(err) });
  }

  return {
    ok: true,
    file,
    relFile: path.relative(path.dirname(contentDir), file),
    importLine: `import { ${key} } from 'virtual:content';`,
    schemasCreated,
    key,
  };
}

function stringifyKey(rootSegment: string, segments: ContentPathSegment[]): string {
  let out = rootSegment;
  for (const seg of segments) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else if (isIdRef(seg)) out += `[@${seg.id}]`;
    else out += `.${seg}`;
  }
  return out;
}

/**
 * For each lock under `rootKey`, rewrite any positional `[N]` segment that
 * points at an array element carrying a string `id` into an `[@id]` segment,
 * using ids present in `existing`. Locks whose element has no id stay
 * positional (lazy migration: they upgrade on the next touch once ids exist).
 */
export function rekeyPositionalLocks(
  existing: unknown,
  lockedKeys: string[],
  rootKey: string,
): string[] {
  return lockedKeys.map((lockedKey) => {
    const parsed = parseContentKey(lockedKey);
    if ('code' in parsed || parsed.rootSegment !== rootKey) return lockedKey;
    const rekeyed: ContentPathSegment[] = [];
    for (let i = 0; i < parsed.path.length; i++) {
      const seg = parsed.path[i]!;
      if (typeof seg === 'number') {
        const container = getAtPath(existing, parsed.path.slice(0, i));
        const el = Array.isArray(container) ? container[seg] : undefined;
        const id = el && typeof el === 'object' ? (el as { id?: unknown }).id : undefined;
        rekeyed.push(typeof id === 'string' ? { id } : seg);
      } else {
        rekeyed.push(seg);
      }
    }
    return stringifyKey(parsed.rootSegment, rekeyed);
  });
}

/**
 * Replace-except-user-locked merge. Returns a deep clone of `incoming` (the
 * agent's new content = the default), then for each locked key whose root
 * segment matches `rootKey`, overwrites the result's value at that path with
 * `existing`'s value — but only when BOTH `existing` and `incoming` have a
 * value there. If `incoming` no longer has the path (restructure), the lock is
 * moot and dropped silently.
 *
 * Pure and defensive: bracket segments are integer indices (`[N]`) or
 * id-anchored refs (`[@id]`, matched against array elements by `.id`); reserved
 * segments (`__proto__`/`constructor`/`prototype`) are rejected by the key parser.
 * Never throws on a normal value — on anything unexpected it falls back to
 * `incoming` (replace).
 */
export function applyLocks(
  existing: unknown,
  incoming: unknown,
  lockedKeys: string[],
  rootKey: string,
): unknown {
  const result = structuredClone(incoming);
  for (const lockedKey of lockedKeys) {
    const parsed = parseContentKey(lockedKey);
    if ('code' in parsed) continue; // malformed key → skip
    if (parsed.rootSegment !== rootKey) continue;
    if (parsed.path.length === 0) continue; // whole-root lock is moot here
    const existingValue = getAtPath(existing, parsed.path);
    if (existingValue === undefined) continue; // user value gone → nothing to preserve
    // Lock target absent in incoming → the user's locked edit is dropped, BY DESIGN:
    // the path was restructured away, or (for an [@id] lock) no incoming item
    // carries that id. With ensureCollectionIds running on every scaffold plus the
    // post-merge pass, the id-orphan case shouldn't arise — but if it does, the edit
    // is recoverable from git, so dropping beats mis-applying it to the wrong item.
    if (getAtPath(result, parsed.path) === undefined) continue;
    setAtPath(result, parsed.path, existingValue);
  }
  return result;
}

// Defense-in-depth: keys are already validated by parseContentKey, but guard
// here too so neither helper can be tricked by values slipping through.
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** Read a value at a ContentPathSegment path, or `undefined` if any segment is absent. */
function getAtPath(value: unknown, segments: ContentPathSegment[]): unknown {
  let current: unknown = value;
  for (const seg of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    if (isIdRef(seg)) {
      if (!Array.isArray(current)) return undefined;
      const found = current.find(
        (el) => el !== null && typeof el === 'object' && (el as { id?: unknown }).id === seg.id,
      );
      if (found === undefined) return undefined;
      current = found;
    } else if (typeof seg === 'number') {
      if (!Array.isArray(current) || seg < 0 || seg >= current.length) return undefined;
      current = current[seg];
    } else {
      if (FORBIDDEN_SEGMENTS.has(seg)) return undefined;
      if (Array.isArray(current)) return undefined;
      if (!Object.prototype.hasOwnProperty.call(current, seg)) return undefined;
      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop -- keys validated by parseContentKey + FORBIDDEN_SEGMENTS guard; reads are hasOwnProperty-guarded
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return current;
}

/**
 * Set a value at a ContentPathSegment path on an existing structure. Assumes the
 * path already exists in `target` (callers guard with getAtPath). No-ops if a
 * parent segment is missing or mistyped, so it never throws on a normal value.
 */
function setAtPath(target: unknown, segments: ContentPathSegment[], value: unknown): void {
  let current: unknown = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (current === null || typeof current !== 'object') return;
    if (isIdRef(seg)) {
      if (!Array.isArray(current)) return;
      const found = current.find(
        (el) => el !== null && typeof el === 'object' && (el as { id?: unknown }).id === seg.id,
      );
      if (found === undefined) return;
      current = found;
    } else if (typeof seg === 'number') {
      if (!Array.isArray(current) || seg < 0 || seg >= current.length) return;
      current = current[seg];
    } else {
      if (FORBIDDEN_SEGMENTS.has(seg)) return;
      if (Array.isArray(current)) return;
      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop -- keys validated by parseContentKey + FORBIDDEN_SEGMENTS guard; reads are hasOwnProperty-guarded
      current = (current as Record<string, unknown>)[seg];
    }
  }
  const last = segments[segments.length - 1]!;
  if (current === null || typeof current !== 'object') return;
  if (isIdRef(last)) {
    if (!Array.isArray(current)) return;
    const idx = current.findIndex(
      (el) => el !== null && typeof el === 'object' && (el as { id?: unknown }).id === last.id,
    );
    if (idx !== -1) current[idx] = value;
  } else if (typeof last === 'number') {
    if (Array.isArray(current) && last >= 0 && last < current.length) current[last] = value;
  } else {
    if (!Array.isArray(current) && !FORBIDDEN_SEGMENTS.has(last)) {
      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop -- keys validated by parseContentKey + FORBIDDEN_SEGMENTS guard; reads are hasOwnProperty-guarded
      (current as Record<string, unknown>)[last] = value;
    }
  }
}

/** Validate name + derive the content key from kind. */
export function resolveKey(kind: ScaffoldKind, name: string | undefined): string | ScaffoldError {
  if (kind === 'site') return SITE_KEY;
  if (kind !== 'page' && kind !== 'collection') {
    return { code: 'invalid-kind', message: `unknown kind "${String(kind)}"` };
  }
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    return {
      code: 'invalid-name',
      message: `"${String(name)}" is not a valid content name. Use lowercase letters, digits, and underscores; must start with a letter or underscore.`,
    };
  }
  if (RESERVED_NAMES.has(name)) {
    return {
      code: 'invalid-name',
      message: `"${name}" is a reserved JavaScript property name`,
    };
  }
  return name;
}

/** Map kind + key to the canonical file path inside `contentDir`. */
export function resolveFilePath(contentDir: string, kind: ScaffoldKind, key: string): string {
  if (kind === 'site') return path.join(contentDir, 'site.json');
  if (kind === 'page') return path.join(contentDir, 'pages', `${key}.json`);
  return path.join(contentDir, 'data', `${key}.json`);
}

/**
 * Emit a TypeScript type from a JSON-compatible value — the structural sibling
 * to `inferZodSchema`, used to generate `virtual-content.d.ts`. Lenient by
 * design: anything it can't type (null/undefined/unexpected) becomes `unknown`
 * rather than throwing, because a .d.ts quirk must never block a scaffold that
 * already succeeded. Heterogeneous arrays use the first element's shape (same
 * documented limitation as inferZodSchema).
 */
export function jsonToTsType(value: unknown): string {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]';
    return `Array<${jsonToTsType(value[0])}>`;
  }
  if (isPlainObjectValue(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const fields = entries.map(([k, v]) => `${JSON.stringify(k)}: ${jsonToTsType(v)}`);
    return `{ ${fields.join('; ')} }`;
  }
  return 'unknown';
}

/**
 * Regenerate `<contentDir>/virtual-content.d.ts` from every content file on
 * disk (site.json, pages/*.json, data/*.json). Structural types, zero imports.
 * Reads each file independently; a single unreadable/unparseable file is
 * skipped (logged) rather than aborting the whole declaration.
 */
export async function emitVirtualContentDts(contentDir: string): Promise<void> {
  const entries: Array<{ key: string; type: string }> = [];

  const addFile = async (key: string, absPath: string): Promise<void> => {
    try {
      if (!NAME_PATTERN.test(key)) {
        logger.warn('content.scaffold.dtsEmit.skipKey', { key });
        return;
      }
      const value: unknown = JSON.parse(await fs.readFile(absPath, 'utf8'));
      entries.push({ key, type: jsonToTsType(value) });
    } catch (err) {
      logger.warn('content.scaffold.dtsEmit.skipFile', { file: absPath, error: getErrorMessage(err) });
    }
  };

  const siteJson = path.join(contentDir, 'site.json');
  if (await fileExists(siteJson)) await addFile('site', siteJson);

  for (const subdir of ['pages', 'data']) {
    const dir = path.join(contentDir, subdir);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue; // subdir absent — normal
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      await addFile(file.replace(/\.json$/, ''), path.join(dir, file));
    }
  }

  await atomicWrite(path.join(contentDir, 'virtual-content.d.ts'), buildVirtualContentDts(entries));
}

/**
 * Assemble a zero-import ambient declaration for the `virtual:content` module.
 * Keys are sorted for stable diffs. No `import` statements — a value import of
 * schemas.ts would be pulled into the runtime graph and rejected by the
 * content-plugin's direct-import guard.
 */
export function buildVirtualContentDts(entries: Array<{ key: string; type: string }>): string {
  const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));
  const lines = [
    '// AUTO-GENERATED by content_scaffold — do not edit.',
    "declare module 'virtual:content' {",
    ...sorted.map((e) => `  export const ${e.key}: ${e.type};`),
    '}',
  ];
  return lines.join('\n') + '\n';
}

/**
 * Walk a JSON-compatible value and emit a Zod schema as source code.
 * Throws on null/undefined (can't infer a type). Heterogeneous arrays use
 * the first item's shape — documented limitation.
 */
export function inferZodSchema(value: unknown): string {
  if (value === null) throw new Error('cannot infer schema from a null value — provide a concrete initial value');
  if (value === undefined) throw new Error('cannot infer schema from undefined');
  if (typeof value === 'string') return 'z.string()';
  if (typeof value === 'number') return 'z.number()';
  if (typeof value === 'boolean') return 'z.boolean()';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'z.array(z.unknown())';
    const first = value[0];
    if (isPlainObjectValue(first) && !Object.prototype.hasOwnProperty.call(first, 'id')) {
      const fields = ['"id": z.string()', ...Object.entries(first).map(
        ([k, v]) => `${JSON.stringify(k)}: ${inferZodSchema(v)}`,
      )];
      return `z.array(z.object({ ${fields.join(', ')} }))`;
    }
    return `z.array(${inferZodSchema(first)})`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return 'z.object({})';
    const fields = entries.map(([k, v]) => `${JSON.stringify(k)}: ${inferZodSchema(v)}`);
    return `z.object({ ${fields.join(', ')} })`;
  }
  throw new Error(`cannot infer schema from value of type ${typeof value}`);
}

/**
 * Insert or replace the `<key>: <zodCode>` entry in the `export const schemas = {...}`
 * object literal of schemas.ts. Preserves all other properties and formatting
 * wherever Babel's generator can; the file round-trips cleanly for the simple
 * shapes the template produces.
 *
 * Throws if the source cannot be parsed or if `schemas` isn't an object literal
 * in a named `export const schemas = {...}` declaration.
 */
export function patchSchemasFile(source: string, key: string, zodCode: string): string {
  const ast = babelParse(source, {
    sourceType: 'module',
    plugins: ['typescript'],
  });

  let schemasObj: t.ObjectExpression | undefined;
  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;
    if (!node.declaration || node.declaration.type !== 'VariableDeclaration') continue;
    for (const decl of node.declaration.declarations) {
      if (
        decl.id.type === 'Identifier' &&
        decl.id.name === 'schemas' &&
        decl.init?.type === 'ObjectExpression'
      ) {
        schemasObj = decl.init;
        break;
      }
    }
    if (schemasObj) break;
  }

  if (!schemasObj) {
    throw new Error(
      'schemas.ts must contain `export const schemas = { ... }` as an object literal. ' +
      'Remove any alternative shapes (default export, re-export, type-only) before scaffolding.',
    );
  }

  // Parse the zodCode expression as a standalone AST node.
  const zodExpr = parseExpression(zodCode);

  // Find an existing property with the same key and replace, or append.
  const existingIndex = schemasObj.properties.findIndex((p) => {
    if (p.type !== 'ObjectProperty') return false;
    if (p.key.type === 'Identifier') return p.key.name === key;
    if (p.key.type === 'StringLiteral') return p.key.value === key;
    return false;
  });

  const newProp = t.objectProperty(t.identifier(key), zodExpr);
  if (existingIndex >= 0) {
    schemasObj.properties[existingIndex] = newProp;
  } else {
    schemasObj.properties.push(newProp);
  }

  const { code } = generate(ast, { retainLines: false, compact: false });
  return code;
}

function parseExpression(source: string): t.Expression {
  const wrapped = `(${source})`;
  const ast = babelParse(wrapped, { sourceType: 'script', plugins: [] });
  const stmt = ast.program.body[0];
  if (!stmt || stmt.type !== 'ExpressionStatement') {
    throw new Error(`could not parse Zod expression: ${source}`);
  }
  return stmt.expression;
}

const CONTENT_PLUGIN_IMPORT = './content-plugin/src/index';

/**
 * Ensure `vite.config.ts` imports and registers `contentPlugin()`. Returns the
 * (possibly patched) source and whether a modification was made. Idempotent —
 * returns `{ modified: false }` when the import already exists.
 */
export function ensureContentPluginRegistered(source: string): { code: string; modified: boolean } {
  const ast = babelParse(source, {
    sourceType: 'module',
    plugins: ['typescript'],
  });

  // Check if contentPlugin import already exists
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration' && node.source.value === CONTENT_PLUGIN_IMPORT) {
      return { code: source, modified: false };
    }
  }

  // Find the plugins array inside the config object
  const pluginsArray = findPluginsArray(ast);
  if (!pluginsArray) {
    return { code: source, modified: false };
  }

  // Prepend contentPlugin() as first element
  pluginsArray.elements.unshift(
    t.callExpression(t.identifier('contentPlugin'), []),
  );

  // Add import declaration after the last existing import
  const importDecl = t.importDeclaration(
    [t.importSpecifier(t.identifier('contentPlugin'), t.identifier('contentPlugin'))],
    t.stringLiteral(CONTENT_PLUGIN_IMPORT),
  );
  let lastImportIdx = -1;
  for (let i = 0; i < ast.program.body.length; i++) {
    if (ast.program.body[i]!.type === 'ImportDeclaration') lastImportIdx = i;
  }
  ast.program.body.splice(lastImportIdx + 1, 0, importDecl);

  const { code } = generate(ast, { retainLines: false, compact: false });
  return { code, modified: true };
}

/**
 * Walk the AST to find the `plugins` ArrayExpression inside the Vite config
 * object. Handles three shapes:
 *   - `export default defineConfig(({ mode }) => ({ plugins: [...] }))`
 *   - `export default defineConfig({ plugins: [...] })`
 *   - `export default { plugins: [...] }`
 */
function findPluginsArray(ast: ReturnType<typeof babelParse>): t.ArrayExpression | null {
  for (const node of ast.program.body) {
    if (node.type !== 'ExportDefaultDeclaration') continue;
    const decl = node.declaration;

    // bare export default { plugins: [...] }
    if (decl.type === 'ObjectExpression') {
      return extractPluginsFromObject(decl);
    }

    // defineConfig(...)
    if (decl.type !== 'CallExpression') continue;
    const arg = decl.arguments[0];
    if (!arg) continue;

    // defineConfig({ plugins: [...] })
    if (arg.type === 'ObjectExpression') {
      return extractPluginsFromObject(arg);
    }

    // defineConfig(({ mode }) => ({ plugins: [...] }))
    if (arg.type === 'ArrowFunctionExpression') {
      const body = arg.body;
      // Parenthesized object: (() => ({...}))
      if (body.type === 'ObjectExpression') {
        return extractPluginsFromObject(body);
      }
      // Block body with return: (() => { return {...}; })
      if (body.type === 'BlockStatement') {
        for (const stmt of body.body) {
          if (stmt.type === 'ReturnStatement' && stmt.argument?.type === 'ObjectExpression') {
            return extractPluginsFromObject(stmt.argument);
          }
        }
      }
    }
  }
  return null;
}

function extractPluginsFromObject(obj: t.ObjectExpression): t.ArrayExpression | null {
  for (const prop of obj.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    const key = prop.key;
    if (key.type !== 'Identifier' || key.name !== 'plugins') continue;
    let val = prop.value;
    // Unwrap `([...] as any[])` → TSAsExpression wrapping the array
    if (val.type === 'TSAsExpression') val = val.expression;
    if (val.type === 'ArrayExpression') return val;
  }
  return null;
}
