import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as babelParse } from '@babel/parser';
import babelGenerate from '@babel/generator';
import * as t from '@babel/types';
import { atomicWrite, fileExists } from '../utils/fs-utils.js';
import { getErrorMessage } from '../utils/error.js';
import { parseContentKey } from './content-editor.js';
import { readUserLocks } from './content-user-edits.js';

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
    finalContent = applyLocks(existing, incoming, lockedKeys, key);
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

  return {
    ok: true,
    file,
    relFile: path.relative(path.dirname(contentDir), file),
    importLine: `import { ${key} } from 'virtual:content';`,
    schemasCreated,
    key,
  };
}

/**
 * Replace-except-user-locked merge. Returns a deep clone of `incoming` (the
 * agent's new content = the default), then for each locked key whose root
 * segment matches `rootKey`, overwrites the result's value at that path with
 * `existing`'s value — but only when BOTH `existing` and `incoming` have a
 * value there. If `incoming` no longer has the path (restructure), the lock is
 * moot and dropped silently.
 *
 * Pure and defensive: integer bracket indices only; reserved segments
 * (`__proto__`/`constructor`/`prototype`) are rejected by the key parser.
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
    if (getAtPath(result, parsed.path) === undefined) continue; // restructured away → drop
    setAtPath(result, parsed.path, existingValue);
  }
  return result;
}

// Defense-in-depth: keys are already validated by parseContentKey, but guard
// here too so neither helper can be tricked by values slipping through.
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** Read a value at a (string|number) path, or `undefined` if any segment is absent. */
function getAtPath(value: unknown, segments: (string | number)[]): unknown {
  let current: unknown = value;
  for (const seg of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    if (typeof seg === 'number') {
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
 * Set a value at a (string|number) path on an existing structure. Assumes the
 * path already exists in `target` (callers guard with getAtPath). No-ops if a
 * parent segment is missing or mistyped, so it never throws on a normal value.
 */
function setAtPath(target: unknown, segments: (string | number)[], value: unknown): void {
  let current: unknown = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (current === null || typeof current !== 'object') return;
    if (typeof seg === 'number') {
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
  if (typeof last === 'number') {
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
    return `z.array(${inferZodSchema(value[0])})`;
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
