import path from 'node:path';
import { parse as babelParse } from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import traverseDefault from '@babel/traverse';
import * as t from '@babel/types';
import * as recast from 'recast';
import * as recastBabelTs from 'recast/parsers/babel-ts.js';
import { arrayDeclaratorLocId } from './content-loc-id.js';

// @babel/traverse ships a CJS default-export interop quirk under ESM bundlers.
// Matches the sanctioned `any` unwrap in content-rules-lint.ts: the upstream
// default-export type isn't callable once `.default` is unwrapped. The `any` is
// confined to this binding — visitor callbacks below are explicitly typed.
const traverse: any = (traverseDefault as any).default ?? traverseDefault;

const PARSE_OPTS: { sourceType: 'module'; plugins: ['jsx', 'typescript'] } = {
  sourceType: 'module',
  plugins: ['jsx', 'typescript'],
};

/** A literal value JSON can represent: string, number, boolean, or null. */
type LiteralValue = string | number | boolean | null;

/** Any JSON-representable value: a literal, a nested array, or a nested object. */
type JsonValue = LiteralValue | JsonValue[] | { [key: string]: JsonValue };

/**
 * The extracted content payload for one array. A flat scalar array is a
 * `LiteralValue[]` (S4), a flat object array a `Record<string, LiteralValue>[]`
 * (S1), and a nested collection an array of nested objects/arrays (S3) — all
 * subsumed by `JsonValue[]`.
 */
export type ExtractedData = JsonValue[];

export interface ExtractableArray {
  arrayName: string;
  data: ExtractedData;
  retainedKeys: string[];
  locId: string | null;
}

export interface ExtractSkip {
  name: string;
  reason: string;
}

export interface ExtractAnalysis {
  extractions: ExtractableArray[];
  skipped: ExtractSkip[];
}

const VIRTUAL_CONTENT_MODULE: string = 'virtual:content';

function parseBabel(source: string): t.File {
  return babelParse(source, PARSE_OPTS) as unknown as t.File;
}

// ── Serializable-literal classification ───────────────────────────────────────

/** True when `node` is a literal value JSON can store (string/number/boolean/null). */
function literalKind(node: t.Node): boolean {
  if (t.isStringLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node) || t.isNumericLiteral(node)) {
    return true;
  }
  // Negative numbers parse as UnaryExpression(-, NumericLiteral).
  return t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument);
}

function literalValue(node: t.Node): LiteralValue {
  if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
    return -node.argument.value;
  }
  if (t.isNullLiteral(node)) return null;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  throw new Error('literalValue called on a non-literal node');
}

interface ElementSplit {
  ok: boolean;
  reason: string | null;
  extractable: Record<string, JsonValue> | null;
  retainedKeys: string[];
}

type LiftResult = { ok: true; value: JsonValue } | { ok: false; reason: string };

/**
 * Recursively lift a nested value (an array or object prop inside an array
 * element) into serializable JSON. Everything below the top level must be
 * pure-liftable: literals, nested literal arrays/objects, and nested scalar
 * arrays. A component/const ref, JSX, function, spread, method, or computed key
 * found at any nested depth declines the whole array — refs are lifted-vs-
 * retained only at the TOP level (that split stays non-recursive). Never throws.
 */
function liftValue(node: t.Node): LiftResult {
  if (literalKind(node)) {
    return { ok: true, value: literalValue(node) };
  }
  if (t.isArrayExpression(node)) {
    const out: JsonValue[] = [];
    for (const el of node.elements) {
      if (el === null) return { ok: false, reason: 'a nested array with a hole/elision' };
      if (t.isSpreadElement(el)) return { ok: false, reason: 'a nested array with a spread element' };
      const lifted: LiftResult = liftValue(el);
      if (!lifted.ok) return lifted;
      out.push(lifted.value);
    }
    return { ok: true, value: out };
  }
  if (t.isObjectExpression(node)) {
    const out: Record<string, JsonValue> = {};
    for (const prop of node.properties) {
      if (t.isSpreadElement(prop) || t.isObjectMethod(prop)) {
        return { ok: false, reason: 'a nested object with a spread or method' };
      }
      if (prop.computed) return { ok: false, reason: 'a nested object with a computed key' };
      const key: string | null = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : null;
      if (key === null) return { ok: false, reason: 'a nested object with a non-literal key' };
      const lifted: LiftResult = liftValue(prop.value);
      if (!lifted.ok) return lifted;
      out[key] = lifted.value;
    }
    return { ok: true, value: out };
  }
  if (t.isJSXElement(node) || t.isJSXFragment(node)) {
    return { ok: false, reason: 'nested JSX (non-serializable)' };
  }
  if (t.isFunction(node) || t.isArrowFunctionExpression(node)) {
    return { ok: false, reason: 'a nested function (non-serializable)' };
  }
  if (t.isIdentifier(node) || t.isMemberExpression(node)) {
    return { ok: false, reason: 'a nested component/const ref (only top-level refs are retained)' };
  }
  return { ok: false, reason: 'a nested unsupported value' };
}

/**
 * Partition one array element's fields into extractable content (literals plus,
 * per S3, recursively-lifted nested arrays/objects) and retained top-level
 * non-literal refs (e.g. `icon: Target`, left local). JSX, functions, spreads,
 * methods, computed/non-literal keys, and refs found NESTED (below the top
 * level) remain HARD skips of the whole array.
 */
function validateElement(el: t.Node): ElementSplit {
  if (!t.isObjectExpression(el)) {
    return { ok: false, reason: 'array element is not an object literal', extractable: null, retainedKeys: [] };
  }
  const extractable: Record<string, JsonValue> = {};
  const retainedKeys: string[] = [];
  for (const prop of el.properties) {
    if (t.isSpreadElement(prop) || t.isObjectMethod(prop)) {
      return { ok: false, reason: 'object element contains a spread or method', extractable: null, retainedKeys: [] };
    }
    if (prop.computed) {
      return { ok: false, reason: 'object element has a computed key', extractable: null, retainedKeys: [] };
    }
    const key: string | null = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null;
    if (key === null) {
      return { ok: false, reason: 'object element has a non-literal key', extractable: null, retainedKeys: [] };
    }
    const propValue: t.Node = prop.value;
    if (t.isJSXElement(propValue) || t.isJSXFragment(propValue)) {
      return { ok: false, reason: `property "${key}" holds JSX (non-serializable)`, extractable: null, retainedKeys: [] };
    }
    if (t.isFunction(propValue) || t.isArrowFunctionExpression(propValue)) {
      return {
        ok: false,
        reason: `property "${key}" holds a function (non-serializable)`,
        extractable: null,
        retainedKeys: [],
      };
    }
    if (literalKind(propValue)) {
      extractable[key] = literalValue(propValue);
    } else if (t.isArrayExpression(propValue) || t.isObjectExpression(propValue)) {
      // S3: recursively lift a nested array/object. Declines (nested ref/JSX/
      // function/spread) propagate as a whole-array skip with the reason.
      const lifted: LiftResult = liftValue(propValue);
      if (!lifted.ok) {
        return { ok: false, reason: `property "${key}" holds ${lifted.reason}`, extractable: null, retainedKeys: [] };
      }
      extractable[key] = lifted.value;
    } else if (t.isIdentifier(propValue) || (t.isMemberExpression(propValue) && !propValue.computed)) {
      // Top-level component/const ref (e.g. `icon: Target`) — retained locally, not lifted.
      retainedKeys.push(key);
    } else {
      return { ok: false, reason: `property "${key}" holds an unsupported value`, extractable: null, retainedKeys: [] };
    }
  }
  if (Object.keys(extractable).length === 0) {
    return { ok: false, reason: 'no extractable (literal) fields', extractable: null, retainedKeys: [] };
  }
  return { ok: true, reason: null, extractable, retainedKeys };
}

interface ArrayShapeCheck {
  ok: boolean;
  reason: string | null;
  data: ExtractedData | null;
  retainedKeys: string[];
}

/**
 * Validate a bare scalar array (`['a','b']`, `[1,2,3]`) — every element must be
 * a JSON literal. Returns the literal values in source order; scalar arrays have
 * no fields, so `retainedKeys` is always empty.
 */
function validateScalarArray(arrayExpr: t.ArrayExpression): ArrayShapeCheck {
  const data: LiteralValue[] = [];
  for (const el of arrayExpr.elements) {
    if (el === null) {
      return { ok: false, reason: 'array contains a hole/elision', data: null, retainedKeys: [] };
    }
    if (t.isSpreadElement(el)) {
      return { ok: false, reason: 'array uses a spread element', data: null, retainedKeys: [] };
    }
    if (!literalKind(el)) {
      return { ok: false, reason: 'array mixes scalar and non-scalar elements', data: null, retainedKeys: [] };
    }
    data.push(literalValue(el));
  }
  return { ok: true, reason: null, data, retainedKeys: [] };
}

/**
 * Validate every element of a module-level array literal, extract its literal
 * data, and confirm the set of retained (non-literal) keys is identical across
 * all elements — else the array is skipped whole.
 */
function validateArray(arrayExpr: t.ArrayExpression): ArrayShapeCheck {
  if (arrayExpr.elements.length === 0) {
    return { ok: false, reason: 'array is empty (no element shape to infer)', data: null, retainedKeys: [] };
  }
  const firstEl: t.ArrayExpression['elements'][number] | undefined = arrayExpr.elements[0];
  if (firstEl != null && !t.isSpreadElement(firstEl) && literalKind(firstEl)) {
    return validateScalarArray(arrayExpr);
  }
  const data: Record<string, JsonValue>[] = [];
  let retainedSignature: string | null = null;
  let retainedKeys: string[] = [];
  for (const el of arrayExpr.elements) {
    if (el === null) {
      return { ok: false, reason: 'array contains a hole/elision', data: null, retainedKeys: [] };
    }
    if (t.isSpreadElement(el)) {
      return { ok: false, reason: 'array uses a spread element', data: null, retainedKeys: [] };
    }
    const check: ElementSplit = validateElement(el);
    if (!check.ok || check.extractable === null) {
      return { ok: false, reason: check.reason, data: null, retainedKeys: [] };
    }
    const signature: string = [...check.retainedKeys].sort().join(',');
    if (retainedSignature === null) {
      retainedSignature = signature;
      retainedKeys = [...check.retainedKeys].sort();
    } else if (signature !== retainedSignature) {
      return { ok: false, reason: 'retained fields differ across elements', data: null, retainedKeys: [] };
    }
    data.push(check.extractable);
  }
  return { ok: true, reason: null, data, retainedKeys };
}

// ── Reference analysis: NAME must be used ONLY by NAME.map(...) ────────────────

interface ReferenceCheck {
  mapCount: number;
  reason: string | null;
}

/**
 * Inspect every reference to `name` that resolves to `candidateBinding`. The only
 * allowed use is being the callee object of `name.map(...)`. Anything else (index,
 * prop-drill, spread, `.length`, passed as an argument) disqualifies. Only
 * references whose resolved binding is that exact binding are counted — this both
 * enforces the shadowing guard (a nested map param resolves to a different
 * binding) and lets two same-named arrays in different function bodies each count
 * only their own `.map`.
 */
function analyzeReferences(
  ast: t.File,
  name: string,
  candidateBinding: ReturnType<NodePath['scope']['getBinding']>,
): ReferenceCheck {
  let mapCount: number = 0;
  let badReason: string | null = null;

  traverse(ast, {
    Identifier(refPath: NodePath<t.Identifier>): void {
      if (refPath.node.name !== name) return;
      if (!refPath.isReferencedIdentifier()) return;
      // Skip the binding id in `const NAME = ...`.
      if (refPath.parentPath?.isVariableDeclarator({ id: refPath.node })) return;
      // Binding-scoped shadowing guard: only count refs to THIS specific binding.
      const binding: ReturnType<typeof refPath.scope.getBinding> = refPath.scope.getBinding(name);
      if (binding !== candidateBinding) return;

      const parent: t.Node = refPath.parent;
      const grandParent: t.Node | null = refPath.parentPath?.parent ?? null;
      const isMapCallee: boolean =
        t.isMemberExpression(parent) &&
        parent.object === refPath.node &&
        !parent.computed &&
        t.isIdentifier(parent.property, { name: 'map' }) &&
        grandParent !== null &&
        t.isCallExpression(grandParent) &&
        grandParent.callee === parent;
      if (isMapCallee) {
        mapCount += 1;
        return;
      }
      if (!badReason) {
        badReason = `referenced outside of \`${name}.map(...)\` (indexed access, prop-drill, spread, or other use)`;
      }
    },
  });

  if (badReason) return { mapCount, reason: badReason };
  if (mapCount === 0) return { mapCount, reason: `never iterated by \`${name}.map(...)\`` };
  if (mapCount > 1) return { mapCount, reason: `iterated by \`${name}.map\` more than once (ambiguous)` };
  return { mapCount, reason: null };
}

// ── Candidate collection ──────────────────────────────────────────────────────

interface ArrayConst {
  name: string;
  init: t.ArrayExpression;
  locId: string | null;
  scopeBlockType: string;
  binding: ReturnType<NodePath['scope']['getBinding']>;
}

/**
 * Traverse ALL `VariableDeclarator` nodes (at any nesting depth) whose `id` is an
 * Identifier and `init` is an ArrayExpression — this captures both module-level
 * and function-local `const NAME = [...]` declarations.
 */
export function collectArrayConsts(ast: t.File): ArrayConst[] {
  const out: ArrayConst[] = [];
  traverse(ast, {
    VariableDeclarator(declPath: NodePath<t.VariableDeclarator>): void {
      const node: t.VariableDeclarator = declPath.node;
      if (!t.isIdentifier(node.id) || !node.init || !t.isArrayExpression(node.init)) return;
      // Only collect `const` declarations.
      if (!t.isVariableDeclaration(declPath.parent, { kind: 'const' })) return;
      const name: string = node.id.name;
      out.push({
        name,
        init: node.init,
        locId: arrayDeclaratorLocId(node.loc),
        scopeBlockType: declPath.scope.block.type,
        binding: declPath.scope.getBinding(name),
      });
    },
  });
  return out;
}

/**
 * The safe-or-skip gate. Returns an extractable array (with extracted data) for
 * every module-level const array that is strictly safe to move into the content
 * layer, and a skip-with-reason for every one that is not. Never throws on
 * parseable input.
 */
export function analyzeExtractable(source: string, pageBinding: string): ExtractAnalysis {
  void pageBinding; // binding affects the rewrite, not the gate verdict
  const ast: t.File = parseBabel(source);
  const extractions: ExtractableArray[] = [];
  const skipped: ExtractSkip[] = [];

  for (const candidate of collectArrayConsts(ast)) {
    const shape: ArrayShapeCheck = validateArray(candidate.init);
    if (!shape.ok || shape.data === null) {
      skipped.push({ name: candidate.name, reason: shape.reason ?? 'unknown' });
      continue;
    }
    const refs: ReferenceCheck = analyzeReferences(ast, candidate.name, candidate.binding);
    if (refs.reason) {
      skipped.push({ name: candidate.name, reason: refs.reason });
      continue;
    }
    extractions.push({
      arrayName: candidate.name,
      data: shape.data,
      retainedKeys: shape.retainedKeys,
      locId: candidate.locId,
    });
  }

  return { extractions, skipped };
}

// ── Page binding resolution ───────────────────────────────────────────────────

/**
 * Valid `virtual:content` binding / export name — must match content-scaffold's
 * `NAME_PATTERN` (a lowercase JS identifier). Pages whose slug can't form one
 * (e.g. `pricing-plans`, `2024-report`) can't be extracted and must decline
 * cleanly rather than throw deep inside scaffold.
 */
const CONTENT_BINDING_PATTERN: RegExp = /^[a-z_][a-z0-9_]*$/;

/**
 * A page's content binding: `index` → `home`, otherwise the file's slug with
 * kebab-case collapsed to underscores so it forms a valid binding (`secret-sauce`
 * → `secret_sauce`, `about-us` → `about_us`). Already-valid slugs pass through
 * unchanged (`about` → `about`).
 *
 * Underscore — not camelCase — because both CONTENT_BINDING_PATTERN and
 * content-scaffold's NAME_PATTERN are lowercase-only (`/^[a-z_][a-z0-9_]*$/`);
 * the binding becomes the `virtual:content` export name (`export const
 * secret_sauce`), so an uppercase letter (`secretSauce`) would be rejected by the
 * scaffold. A slug that still can't form a valid binding after normalization
 * (e.g. `2024-report`, leading digit) is caught by CONTENT_BINDING_PATTERN at the
 * caller and declines cleanly.
 */
export function bindingForPage(pageRelPath: string): string {
  const base: string = path.basename(pageRelPath).replace(/\.(tsx|jsx|ts|js)$/, '');
  if (base === 'index') return 'home';
  return base.replace(/-+/g, '_');
}

// ── Already-extracted detection (idempotency) ─────────────────────────────────

/**
 * True when the page already imports `binding` from `virtual:content` and the
 * named const has been removed — i.e. this array is already living in the
 * content layer. Such a candidate is a no-op, not an extraction and not a skip.
 */
function importsBinding(ast: t.File, binding: string): boolean {
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node) || node.source.value !== VIRTUAL_CONTENT_MODULE) continue;
    if (
      node.specifiers.some(
        (s) => t.isImportSpecifier(s) && t.isIdentifier(s.imported, { name: binding }),
      )
    ) {
      return true;
    }
  }
  return false;
}

// ── Page rewrite via recast (formatting-preserving) ───────────────────────────

// ast-types visitor NodePath param types, sourced from recast's own `Visitor`
// interface so we stay off a direct `ast-types` import (dependency-validation).
type CallPath = Parameters<NonNullable<recast.types.Visitor['visitCallExpression']>>[0];
type MemberPath = Parameters<NonNullable<recast.types.Visitor['visitMemberExpression']>>[0];
type JSXMemberPath = Parameters<
  NonNullable<recast.types.Visitor['visitJSXMemberExpression']>
>[0];
type VariableDeclaratorPath = Parameters<
  NonNullable<recast.types.Visitor['visitVariableDeclarator']>
>[0];
type FunctionDeclarationPath = Parameters<
  NonNullable<recast.types.Visitor['visitFunctionDeclaration']>
>[0];

// Matches `<identifier>.map` that is not already part of a longer member chain
// (no preceding word char or `.`). Hardcoded — not built per name — so there is
// no dynamic-RegExp/ReDoS surface; the captured identifier is filtered in JS.
const MAP_CALLEE_PATTERN: RegExp = /(?<![\w.])([A-Za-z_$][\w$]*)\.map\b/g;

/**
 * The remainder-const base name for a retained-field array (`stats` → `statsMeta`).
 * Callers that need a unique name must call `uniqueMetaName` instead.
 */
function metaName(arrayName: string): string {
  return `${arrayName}Meta`;
}

/**
 * A unique `<arrayName>Meta` name that does not collide with any name already
 * bound at module scope (e.g. an existing `const statsMeta` or
 * `import { statsMeta }`). Suffixes with 2, 3, … until unique, mirroring how
 * `uniqueCapName` handles hoisted-local collisions.
 */
function uniqueMetaName(arrayName: string, moduleScope: Set<string>): string {
  const base: string = metaName(arrayName);
  if (!moduleScope.has(base)) return base;
  let suffix: number = 2;
  while (moduleScope.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

/** Collect all names bound at module scope (variable decls, imports, function decls, export wrappers). */
function collectModuleScopeNames(program: t.Program): Set<string> {
  const names: Set<string> = new Set<string>();
  for (const stmt of program.body) {
    const inner: t.Statement =
      (t.isExportNamedDeclaration(stmt) || t.isExportDefaultDeclaration(stmt)) &&
      stmt.declaration !== null &&
      stmt.declaration !== undefined &&
      !t.isExpression(stmt.declaration)
        ? (stmt.declaration as unknown as t.Statement)
        : stmt;
    if (t.isVariableDeclaration(inner)) {
      for (const decl of inner.declarations) {
        if (t.isIdentifier(decl.id)) names.add(decl.id.name);
      }
    } else if (t.isImportDeclaration(inner)) {
      for (const spec of inner.specifiers) {
        if (t.isIdentifier(spec.local)) names.add(spec.local.name);
      }
    } else if (t.isFunctionDeclaration(inner) && inner.id) {
      names.add(inner.id.name);
    }
  }
  return names;
}

/**
 * Collect const binding names declared in the direct body of the function (or
 * block) that immediately owns `targetDeclarator`. When the declarator is at
 * module level, returns an empty set (module scope is handled by
 * `collectModuleScopeNames`). Used to prevent `uniqueMetaName` from picking a
 * name that collides with a same-scope pre-existing `const <name>Meta`.
 */
function collectEnclosingFunctionNames(program: t.Program, targetDeclarator: t.VariableDeclarator): Set<string> {
  const names: Set<string> = new Set<string>();
  recast.types.visit(program, {
    visitFunction(fnPath: FunctionDeclarationPath): boolean {
      const body: t.Node = fnPath.node.body as unknown as t.Node;
      if (!t.isBlockStatement(body)) {
        this.traverse(fnPath);
        return false;
      }
      const stmts: t.Statement[] = (body as t.BlockStatement).body;
      // Check if targetDeclarator is a direct-child const in this function body.
      for (const stmt of stmts) {
        if (!t.isVariableDeclaration(stmt)) continue;
        for (const decl of stmt.declarations) {
          if (decl !== (targetDeclarator as unknown as typeof decl)) continue;
          // Found the function that directly owns our declarator — collect its bindings.
          for (const s of stmts) {
            if (t.isVariableDeclaration(s)) {
              for (const d of s.declarations) {
                if (t.isIdentifier(d.id)) names.add(d.id.name);
              }
            }
          }
          return false;
        }
      }
      this.traverse(fnPath);
      return false;
    },
  });
  return names;
}

/**
 * Shared retained-split body: rename `declarator.id` to a unique `<name>Meta`,
 * filter each element down to retained props, and redirect reads inside `mapCall`'s
 * callback. Called by both `splitRetainedArray` (module-level, after resolving by
 * name) and `splitRetainedDeclarator` (scope-agnostic, already resolved by loc-id).
 * Throws the shared "unsafe rewrite" error on any unresolvable callback shape.
 */
function applyRetainedSplit(
  declarator: t.VariableDeclarator,
  mapCall: t.CallExpression,
  plan: ExtractableArray,
  program: t.Program,
  builders: typeof recast.types.builders,
): void {
  if (!t.isArrayExpression(declarator.init)) {
    throw new Error(`unsafe rewrite: \`${plan.arrayName}\` init is not an array literal`);
  }

  // Uniquify the remainder name against the current module scope AND the
  // enclosing function scope (for function-local declarators) so an existing
  // `const statsMeta` in either scope doesn't produce a duplicate lexical binding.
  const moduleScope: Set<string> = collectModuleScopeNames(program);
  const enclosingNames: Set<string> = collectEnclosingFunctionNames(program, declarator);
  const combinedScope: Set<string> = new Set([...moduleScope, ...enclosingNames]);
  const resolvedMetaName: string = uniqueMetaName(plan.arrayName, combinedScope);

  const retained: Set<string> = new Set(plan.retainedKeys);
  declarator.id = builders.identifier(resolvedMetaName) as unknown as t.Identifier;
  declarator.init.elements = declarator.init.elements.map((el: t.ArrayExpression['elements'][number]) => {
    if (!t.isObjectExpression(el)) {
      throw new Error(`unsafe rewrite: \`${plan.arrayName}\` element is not an object literal`);
    }
    const kept: t.ObjectExpression['properties'] = el.properties.filter(
      (prop: t.ObjectExpression['properties'][number]): boolean =>
        t.isObjectProperty(prop) &&
        ((t.isIdentifier(prop.key) && retained.has(prop.key.name)) ||
          (t.isStringLiteral(prop.key) && retained.has(prop.key.value))),
    );
    return builders.objectExpression(
      kept as unknown as recast.types.namedTypes.ObjectExpression['properties'],
    ) as unknown as t.ObjectExpression;
  });

  redirectRetainedReadsForCall(program, mapCall, plan, retained, builders, resolvedMetaName);
}

/**
 * Split one retained-field array declarator in place: keep only the retained
 * props in each element, rename the binding to `<name>Meta`, and redirect every
 * `<param>.<retainedKey>` read inside the `.map` callback to
 * `<name>Meta[<idx>].<retainedKey>`.
 *
 * Mutates AST nodes inside the JSX callback (recast will reprint that subtree —
 * accepted; behavior preservation is the gate). Throws the shared "unsafe
 * rewrite" error when the callback is not an arrow/function whose index param is
 * resolvable, so the caller declines to a no-op.
 */
function splitRetainedArray(
  program: t.Program,
  plan: ExtractableArray,
  builders: typeof recast.types.builders,
): void {
  const declarator: t.VariableDeclarator | null = findArrayDeclarator(program, plan.arrayName);
  if (declarator === null || !t.isArrayExpression(declarator.init)) {
    throw new Error(`unsafe rewrite: could not locate \`const ${plan.arrayName}\` to split`);
  }
  const mapCall: t.CallExpression | null = findMapCall(program, plan.arrayName);
  if (mapCall === null) {
    throw new Error(`unsafe rewrite: could not locate \`${plan.arrayName}.map\` call`);
  }
  applyRetainedSplit(declarator, mapCall, plan, program, builders);
}

/** Find the `.map` CallExpression whose callee object is the named identifier. */
function findMapCall(program: t.Program, arrayName: string): t.CallExpression | null {
  let found: t.CallExpression | null = null;
  recast.types.visit(program, {
    visitCallExpression(
      callPath: CallPath,
    ): boolean | undefined {
      const node: t.CallExpression = callPath.node as unknown as t.CallExpression;
      const callee: t.Node = node.callee;
      if (
        t.isMemberExpression(callee) &&
        !callee.computed &&
        t.isIdentifier(callee.property, { name: 'map' }) &&
        t.isIdentifier(callee.object, { name: arrayName })
      ) {
        found = node;
        return false;
      }
      this.traverse(callPath);
      return undefined;
    },
  });
  return found;
}

/** `<name>Meta[<idx>].<key>` — the indexed remainder read for one retained field. */
function indexedRetainedRead(
  meta: string,
  idxName: string,
  key: string,
  builders: typeof recast.types.builders,
): recast.types.namedTypes.MemberExpression {
  const indexed: recast.types.namedTypes.MemberExpression = builders.memberExpression(
    builders.identifier(meta),
    builders.identifier(idxName),
    true,
  );
  return builders.memberExpression(indexed, builders.identifier(key), false);
}

/**
 * The call-based core of `redirectRetainedReads`: given the array's `.map`
 * CallExpression (already resolved by name at module scope OR by scope identity
 * for the id-addressed path), redirect the retained reads inside its callback.
 * `program` is used only to collect module-scope names for hoisted-local
 * collision avoidance.
 */
function redirectRetainedReadsForCall(
  program: t.Program,
  mapCall: t.CallExpression | null,
  plan: ExtractableArray,
  retained: Set<string>,
  builders: typeof recast.types.builders,
  resolvedMetaName?: string,
): void {
  const callback: t.Node | undefined = mapCall?.arguments[0];
  if (
    !callback ||
    (!t.isArrowFunctionExpression(callback) && !t.isFunctionExpression(callback))
  ) {
    throw new Error(
      `unsafe rewrite: \`${plan.arrayName}.map\` callback is not an inline arrow/function`,
    );
  }

  const itemParam: t.Node | undefined = callback.params[0];
  if (!itemParam || !t.isIdentifier(itemParam)) {
    throw new Error(`unsafe rewrite: \`${plan.arrayName}.map\` callback has no item identifier param`);
  }
  const itemName: string = itemParam.name;

  const secondParam: t.Node | undefined = callback.params[1];
  const idxName: string = resolveIndexParam(callback, secondParam, builders);
  // Use the pre-computed unique meta name when provided (from splitRetainedArray,
  // which already uniquified it against module scope).
  const meta: string = resolvedMetaName ?? metaName(plan.arrayName);

  // A unique capitalized local per retained key rendered as a JSX tag, so the
  // hoisted binding can't collide with an existing module/callback binding.
  const reserved: Set<string> = collectBoundNames(program, callback);
  const tagLocals: Map<string, string> = new Map<string, string>();
  const localFor = (key: string): string => {
    const existing: string | undefined = tagLocals.get(key);
    if (existing !== undefined) return existing;
    const name: string = uniqueCapName(key, reserved);
    reserved.add(name);
    tagLocals.set(key, name);
    return name;
  };

  // Every retained key is a plain identifier: a non-identifier key (`"my-icon"`)
  // could only be read as `s["my-icon"]` (computed member — filtered out below)
  // and `<s.my-icon/>` isn't valid JSX, so it never reaches these two paths — the
  // `builders.identifier(key)` calls here and in indexedRetainedRead are safe.

  // 1. Rewrite JSX-tag reads (`<s.icon/>` → `<Icon/>`), collecting the locals.
  recast.types.visit(callback.body, {
    visitJSXMemberExpression(
      tagPath: JSXMemberPath,
    ): boolean | undefined {
      const tag: t.JSXMemberExpression = tagPath.node as unknown as t.JSXMemberExpression;
      if (
        t.isJSXIdentifier(tag.object, { name: itemName }) &&
        retained.has(tag.property.name)
      ) {
        tagPath.replace(builders.jsxIdentifier(localFor(tag.property.name)));
        return false;
      }
      this.traverse(tagPath);
      return undefined;
    },
  });

  // 2. Rewrite expression-position reads (`{s.icon}` → `statsMeta[i].icon`).
  recast.types.visit(callback.body, {
    visitMemberExpression(
      memberPath: MemberPath,
    ): boolean | undefined {
      const member: t.MemberExpression = memberPath.node as unknown as t.MemberExpression;
      if (
        t.isIdentifier(member.object, { name: itemName }) &&
        !member.computed &&
        t.isIdentifier(member.property) &&
        retained.has(member.property.name)
      ) {
        memberPath.replace(indexedRetainedRead(meta, idxName, member.property.name, builders));
        return false;
      }
      this.traverse(memberPath);
      return undefined;
    },
  });

  // 3. Hoist `const <Cap> = <name>Meta[<idx>].<key>` for every tag-rendered key.
  if (tagLocals.size > 0) {
    hoistTagLocals(callback, tagLocals, meta, idxName, builders);
  }

  // 4. Safety check: after all redirects, no reference to the item param in an
  //    *unhandled position* must remain inside the callback body. Unhandled
  //    positions are those that could access a retained key via a path the two
  //    rewrite passes don't cover:
  //      - Computed member access `s['icon']` — we can't know the key at rewrite
  //        time, so we can't rule out a retained-key read.
  //      - Whole-object pass: `s` used as a JSX attribute value, a call argument,
  //        or a spread operand — the callee/child receives the full item (with no
  //        retained field) and silently drops it.
  //    Legitimate survivors: `s.literalField` (non-computed member, non-retained
  //    key) — these refer to extractable fields that are now content items, so
  //    they're fine after the callee rename.
  let residualUnhandledRef: boolean = false;
  recast.types.visit(callback.body, {
    visitIdentifier(idPath: Parameters<NonNullable<recast.types.Visitor['visitIdentifier']>>[0]): boolean | undefined {
      const node: t.Identifier = idPath.node as unknown as t.Identifier;
      if (node.name !== itemName) {
        this.traverse(idPath);
        return undefined;
      }
      // In recast's visitor, `idPath.parent` is the parent NodePath; `.node`
      // on it gives the parent AST node.
      const parentNode: t.Node = (idPath.parent as unknown as { node: t.Node }).node;
      // Skip the param binding itself (the Identifier IS the param, not a reference).
      const isParamBinding: boolean =
        (t.isArrowFunctionExpression(parentNode) || t.isFunctionExpression(parentNode)) &&
        (parentNode as t.ArrowFunctionExpression).params.some((p: t.Node): boolean => p === (node as unknown as t.Node));
      if (isParamBinding) {
        this.traverse(idPath);
        return undefined;
      }
      // Non-computed member `s.prop` where `s` is the object — safe: refers to
      // an extractable field (retained keys were already redirected away).
      const isSafeNonComputedMember: boolean =
        t.isMemberExpression(parentNode) &&
        (parentNode as t.MemberExpression).object === (node as unknown as t.Node) &&
        !(parentNode as t.MemberExpression).computed;
      if (isSafeNonComputedMember) {
        this.traverse(idPath);
        return undefined;
      }
      // Non-computed member PROPERTY `x.<itemName>` — the identifier is a
      // property name that merely collides with the item param name (e.g. a
      // `category` param over items whose lifted field is also `category`), not a
      // reference to the param. Safe. (Guards the property side of a member; the
      // object side is handled above.)
      const isNonComputedMemberProperty: boolean =
        t.isMemberExpression(parentNode) &&
        (parentNode as t.MemberExpression).property === (node as unknown as t.Node) &&
        !(parentNode as t.MemberExpression).computed;
      if (isNonComputedMemberProperty) {
        this.traverse(idPath);
        return undefined;
      }
      // Object-property key `{ <itemName>: … }` (non-computed, non-shorthand) —
      // likewise a key name colliding with the param, not a reference.
      const isNonComputedObjectKey: boolean =
        t.isObjectProperty(parentNode) &&
        (parentNode as t.ObjectProperty).key === (node as unknown as t.Node) &&
        !(parentNode as t.ObjectProperty).computed &&
        !(parentNode as t.ObjectProperty).shorthand;
      if (isNonComputedObjectKey) {
        this.traverse(idPath);
        return undefined;
      }
      // Every other position is unhandled (computed member, spread, call arg,
      // JSX attribute value, etc.).
      residualUnhandledRef = true;
      return false;
    },
  });
  if (residualUnhandledRef) {
    throw new Error(
      `unsafe rewrite: item param \`${itemName}\` has unhandled uses in the \`${plan.arrayName}.map\` callback (computed member, spread, or whole-object pass)`,
    );
  }
}

/**
 * Prepend `const <Cap> = <name>Meta[<idx>].<key>` bindings to the callback body,
 * converting an expression-bodied arrow into a block that returns the original
 * expression.
 */
function hoistTagLocals(
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
  tagLocals: Map<string, string>,
  meta: string,
  idxName: string,
  builders: typeof recast.types.builders,
): void {
  const bindings: recast.types.namedTypes.VariableDeclaration[] = [...tagLocals.entries()].map(
    ([key, local]: [string, string]): recast.types.namedTypes.VariableDeclaration =>
      builders.variableDeclaration('const', [
        builders.variableDeclarator(
          builders.identifier(local),
          indexedRetainedRead(meta, idxName, key, builders),
        ),
      ]),
  );

  if (t.isBlockStatement(callback.body)) {
    const block: t.BlockStatement = callback.body;
    block.body.unshift(...(bindings as unknown as t.Statement[]));
    return;
  }
  const returned: Parameters<typeof builders.returnStatement>[0] =
    callback.body as unknown as Parameters<typeof builders.returnStatement>[0];
  callback.body = builders.blockStatement([
    ...bindings,
    builders.returnStatement(returned),
  ]) as unknown as t.BlockStatement;
}

/**
 * Every identifier bound at module level, as a callback param, OR declared inside
 * the callback body — the full name-collision surface for a hoisted `<Cap>` local.
 * Body-local declarations matter: hoisting `const Icon` when the callback already
 * declares `const Icon` would be a runtime redeclare error.
 */
function collectBoundNames(
  program: t.Program,
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
): Set<string> {
  const names: Set<string> = new Set<string>();
  for (const stmt of program.body) {
    // Unwrap export wrappers so `export const Icon = …` and `export function Icon`
    // are treated the same as their non-exported counterparts. Without this,
    // hoisting `const Icon` would shadow an exported `Icon` → wrong component.
    const inner: t.Statement =
      (t.isExportNamedDeclaration(stmt) || t.isExportDefaultDeclaration(stmt)) &&
      stmt.declaration !== null &&
      stmt.declaration !== undefined &&
      !t.isExpression(stmt.declaration)
        ? (stmt.declaration as unknown as t.Statement)
        : stmt;
    if (t.isVariableDeclaration(inner)) {
      for (const decl of inner.declarations) {
        if (t.isIdentifier(decl.id)) names.add(decl.id.name);
      }
    } else if (t.isImportDeclaration(inner)) {
      for (const spec of inner.specifiers) {
        if (t.isIdentifier(spec.local)) names.add(spec.local.name);
      }
    } else if (t.isFunctionDeclaration(inner) && inner.id) {
      names.add(inner.id.name);
    }
  }
  for (const p of callback.params) {
    if (t.isIdentifier(p)) names.add(p.name);
  }
  recast.types.visit(callback.body, {
    visitVariableDeclarator(declPath: VariableDeclaratorPath): boolean | undefined {
      const decl: t.VariableDeclarator = declPath.node as unknown as t.VariableDeclarator;
      if (t.isIdentifier(decl.id)) names.add(decl.id.name);
      this.traverse(declPath);
      return undefined;
    },
    visitFunctionDeclaration(fnPath: FunctionDeclarationPath): boolean | undefined {
      const fn: t.FunctionDeclaration = fnPath.node as unknown as t.FunctionDeclaration;
      if (fn.id) names.add(fn.id.name);
      this.traverse(fnPath);
      return undefined;
    },
  });
  return names;
}

/** A unique capitalized local for a retained key (`icon` → `Icon`, then `Icon2`, …). */
function uniqueCapName(key: string, reserved: Set<string>): string {
  const base: string = key.charAt(0).toUpperCase() + key.slice(1);
  if (!reserved.has(base)) return base;
  let suffix: number = 2;
  while (reserved.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

/**
 * Resolve the callback's index param name: reuse the 2nd param if it is an
 * identifier; else synthesize a unique name (mirroring source-mapper's
 * `scope.generateUid('airoIdx')`) and push it as the 2nd param. A non-identifier
 * (destructured) 2nd param can't be referenced by name — that is an unsafe split.
 */
function resolveIndexParam(
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
  secondParam: t.Node | undefined,
  builders: typeof recast.types.builders,
): string {
  if (secondParam !== undefined) {
    if (!t.isIdentifier(secondParam)) {
      throw new Error('unsafe rewrite: map callback index param is not a plain identifier');
    }
    return secondParam.name;
  }
  const synthesized: string = uniqueIdxName(callback);
  callback.params.push(builders.identifier(synthesized) as unknown as t.Identifier);
  return synthesized;
}

/** A unique `_airoIdx`-style name not already bound as a callback param. */
function uniqueIdxName(
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
): string {
  const taken: Set<string> = new Set(
    callback.params
      .filter((p: t.Node): p is t.Identifier => t.isIdentifier(p))
      .map((p: t.Identifier): string => p.name),
  );
  let candidate: string = '_airoIdx';
  let suffix: number = 0;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `_airoIdx${suffix}`;
  }
  return candidate;
}

/** Find the module-level `const NAME = [...]` declarator, or `null`. */
function findArrayDeclarator(program: t.Program, name: string): t.VariableDeclarator | null {
  for (const stmt of program.body) {
    if (!t.isVariableDeclaration(stmt) || stmt.kind !== 'const') continue;
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id, { name }) && decl.init && t.isArrayExpression(decl.init)) {
        return decl;
      }
    }
  }
  return null;
}

// ── Binding-precise rewrite (id-addressed, scope-agnostic) ────────────────────

/**
 * The `import { <binding> } from 'virtual:content'` statement is ensured (added
 * to an existing line or prepended). Shared by the batch and binding-precise
 * rewrite paths.
 */
function ensureContentImport(
  program: t.Program,
  binding: string,
  builders: typeof recast.types.builders,
): void {
  let hasImport: boolean = false;
  for (const node of program.body) {
    if (!t.isImportDeclaration(node) || node.source.value !== VIRTUAL_CONTENT_MODULE) continue;
    hasImport = true;
    if (
      !node.specifiers.some(
        (s) => t.isImportSpecifier(s) && t.isIdentifier(s.imported, { name: binding }),
      )
    ) {
      node.specifiers.push(
        builders.importSpecifier(builders.identifier(binding)) as unknown as t.ImportSpecifier,
      );
    }
  }
  if (!hasImport) {
    const decl: t.ImportDeclaration = builders.importDeclaration(
      [builders.importSpecifier(builders.identifier(binding))],
      builders.stringLiteral(VIRTUAL_CONTENT_MODULE),
    ) as unknown as t.ImportDeclaration;
    program.body.unshift(decl);
  }
}

/**
 * Locate the single target `VariableDeclarator` NodePath whose `id` name and
 * source loc-id match `conformId`, along with its enclosing scope block node
 * (Program or a function/block). Returns `null` when no declarator matches — the
 * caller declines cleanly.
 *
 * Matching on loc-id (not just name) is the whole point of the id-addressed path:
 * two same-named arrays in different scopes have distinct declarator locs, so
 * only the addressed one is ever selected.
 */
function findTargetDeclaratorPath(
  ast: recast.types.ASTNode,
  arrayName: string,
  conformId: string,
): { declPath: VariableDeclaratorPath; scopeNode: t.Node } | null {
  let match: { declPath: VariableDeclaratorPath; scopeNode: t.Node } | null = null;
  recast.types.visit(ast, {
    visitVariableDeclarator(declPath: VariableDeclaratorPath): boolean | undefined {
      const node: t.VariableDeclarator = declPath.node as unknown as t.VariableDeclarator;
      if (
        match === null &&
        t.isIdentifier(node.id, { name: arrayName }) &&
        node.init &&
        t.isArrayExpression(node.init) &&
        arrayDeclaratorLocId(node.loc) === conformId
      ) {
        match = {
          declPath,
          scopeNode: (declPath.scope as unknown as { node: t.Node }).node,
        };
        return false;
      }
      this.traverse(declPath);
      return undefined;
    },
  });
  return match;
}

/**
 * Find the single `<name>.map(...)` CallExpression whose `<name>` reference
 * resolves to `scopeNode`'s binding. A same-named array bound in another scope
 * resolves elsewhere and is ignored. Returns the node plus a count of matches so
 * the caller can refuse an ambiguous (>1) or missing (0) target.
 */
function findScopedMapCall(
  ast: recast.types.ASTNode,
  arrayName: string,
  scopeNode: t.Node,
): { call: t.CallExpression | null; count: number } {
  let call: t.CallExpression | null = null;
  let count: number = 0;
  recast.types.visit(ast, {
    visitCallExpression(callPath: CallPath): boolean | undefined {
      const node: t.CallExpression = callPath.node as unknown as t.CallExpression;
      const callee: t.Node = node.callee;
      if (
        t.isMemberExpression(callee) &&
        !callee.computed &&
        t.isIdentifier(callee.property, { name: 'map' }) &&
        t.isIdentifier(callee.object, { name: arrayName })
      ) {
        const resolved: { node: t.Node } | null =
          (callPath.scope.lookup(arrayName) as unknown as { node: t.Node } | null) ?? null;
        if (resolved !== null && resolved.node === scopeNode) {
          call = node;
          count += 1;
        }
      }
      this.traverse(callPath);
      return undefined;
    },
  });
  return { call, count };
}

/**
 * Rewrite one resolved `<name>.map` callee → `<binding>.<name>.map` by replacing
 * the callee's object identifier with a `<binding>.<name>` MemberExpression.
 */
function rewriteMapCallee(
  call: t.CallExpression,
  arrayName: string,
  binding: string,
  builders: typeof recast.types.builders,
): void {
  const callee: t.MemberExpression = call.callee as t.MemberExpression;
  callee.object = builders.memberExpression(
    builders.identifier(binding),
    builders.identifier(arrayName),
    false,
  ) as unknown as t.MemberExpression;
}

/**
 * Remove the target declarator from its enclosing statement list (Program body
 * OR a function/block body). When the declaration shares a statement with other
 * declarators (`const a = 1, items = [...]`), only the target declarator is
 * dropped so sibling bindings survive.
 */
function removeTargetDeclarator(declPath: VariableDeclaratorPath): void {
  // In ast-types, a VariableDeclarator's `parentPath` is the `declarations`
  // array path; the enclosing VariableDeclaration statement is one level up.
  const declaration: t.VariableDeclaration = (
    declPath.parentPath.parentPath as unknown as { node: t.VariableDeclaration }
  ).node;
  if (declaration.declarations.length > 1) {
    // Sibling bindings survive — drop only this declarator from the array.
    (declPath as unknown as { prune: () => void }).prune();
    return;
  }
  // Lone declarator — prune the whole statement so no empty `const;` remains.
  (declPath.parentPath.parentPath as unknown as { prune: () => void }).prune();
}

/**
 * The id-addressed, binding-precise rewrite. Unlike the batch path (global
 * `MAP_CALLEE_PATTERN` text-sub), this rewrites ONLY the addressed binding's
 * `.map` via scope reference resolution and drops ONLY that binding's declarator
 * from its own scope — a same-named array elsewhere is byte-unchanged.
 *
 * Retained-field targets reuse the S1 split machinery scoped to the declarator's
 * own `.map` call (found by node identity, not name). Throws the shared "unsafe
 * rewrite" error → caller declines to a no-op.
 */
function rewritePageBindingPrecise(
  source: string,
  binding: string,
  plan: ExtractableArray,
  conformId: string,
): string {
  const ast: recast.types.ASTNode = recast.parse(source, { parser: recastBabelTs });
  const builders: typeof recast.types.builders = recast.types.builders;
  const program: t.Program = (ast as unknown as { program: t.Program }).program;

  const target: { declPath: VariableDeclaratorPath; scopeNode: t.Node } | null =
    findTargetDeclaratorPath(ast, plan.arrayName, conformId);
  if (target === null) {
    throw new Error(
      `unsafe rewrite: could not locate \`const ${plan.arrayName}\` at conform-id ${conformId}`,
    );
  }

  // Resolve the addressed `.map` call while the binding still has its original
  // name (a retained split renames the declarator to `<name>Meta`, and rewriting
  // the callee below repoints it to `<binding>.<name>` — either would break a
  // later name-based lookup). Refuse an ambiguous or missing target.
  const scoped: { call: t.CallExpression | null; count: number } = findScopedMapCall(
    ast,
    plan.arrayName,
    target.scopeNode,
  );
  if (scoped.call === null || scoped.count !== 1) {
    throw new Error(
      `unsafe rewrite: expected exactly one \`${plan.arrayName}.map\` for the addressed binding, found ${scoped.count}`,
    );
  }
  const mapCall: t.CallExpression = scoped.call;

  if (plan.retainedKeys.length > 0) {
    splitRetainedDeclarator(program, target.declPath, mapCall, plan, builders);
  }

  rewriteMapCallee(mapCall, plan.arrayName, binding, builders);

  // All-literal targets drop the declarator entirely; retained-field targets keep
  // the reduced `<name>Meta` remainder produced by the split.
  if (plan.retainedKeys.length === 0) {
    removeTargetDeclarator(target.declPath);
  }

  ensureContentImport(program, binding, builders);

  return recast.print(ast, { quote: 'single' }).code;
}

/**
 * Split ONE addressed retained-field declarator in place (scope-agnostic): rename
 * it to a unique `<name>Meta`, drop the extractable fields per element, and
 * redirect retained reads inside `mapCall`'s callback. `mapCall` is resolved by
 * the caller (by scope identity, name intact) so this stays correct after the
 * rename. Delegates the shared mutation body to `applyRetainedSplit`.
 */
function splitRetainedDeclarator(
  program: t.Program,
  declPath: VariableDeclaratorPath,
  mapCall: t.CallExpression,
  plan: ExtractableArray,
  builders: typeof recast.types.builders,
): void {
  applyRetainedSplit(declPath.node as unknown as t.VariableDeclarator, mapCall, plan, program, builders);
}

/**
 * Rewrite the page so extracted arrays read from `virtual:content`: ensure the
 * `import { <binding> } from 'virtual:content'` line, and for each extracted
 * array either drop its all-literal `const NAME = [...]` (no retained fields) or
 * split it into a reduced local `const NAMEMeta = [...]` remainder (retained
 * fields). In both cases the `NAME.map` callee is rewritten to `<binding>.NAME.map`.
 *
 * The import-add and const-removal are top-level statement edits, which recast
 * reprints cleanly while preserving every untouched node verbatim. The `.map`
 * rename is applied as a precise text substitution on the printed source rather
 * than as an AST mutation: mutating a `MemberExpression` deep inside JSX makes
 * recast reprint the whole enclosing element and drop blank lines between JSX
 * siblings. The substitution is safe because the gate guarantees each extracted
 * `NAME` is referenced ONLY by exactly one `NAME.map(...)`; the `(?<![\w.])`
 * lookbehind keeps it from matching an already-prefixed `<binding>.NAME.map`
 * (idempotency) or a longer identifier ending in `NAME`. `NAMEMeta.map` never
 * matches `NAME.map` (word boundary), so the remainder stays local.
 *
 * Retained-field arrays additionally mutate MemberExpressions inside the `.map`
 * callback (`<param>.<key>` → `<name>Meta[<idx>].<key>`), which forces recast to
 * reprint that callback subtree — accepted; behavior preservation is the gate.
 */
function rewritePage(source: string, binding: string, plans: ExtractableArray[]): string {
  const ast: recast.types.ASTNode = recast.parse(source, { parser: recastBabelTs });
  const builders: typeof recast.types.builders = recast.types.builders;
  const program: t.Program = (ast as unknown as { program: t.Program }).program;

  const extractedNames: string[] = plans.map((p: ExtractableArray): string => p.arrayName);
  const dropNames: Set<string> = new Set(
    plans.filter((p: ExtractableArray): boolean => p.retainedKeys.length === 0).map((p) => p.arrayName),
  );

  // 1a. Split retained-field arrays into `<name>Meta` remainders (AST mutation).
  for (const plan of plans) {
    if (plan.retainedKeys.length === 0) continue;
    splitRetainedArray(program, plan, builders);
  }

  // 1b. Drop all-literal extracted const declarations — one declarator at a time.
  // Dropping the whole statement for `const A = 1, items = [...]` would silently
  // remove `A` and cause a ReferenceError at runtime. Instead, filter out only the
  // extracted declarator(s); keep the statement when other declarators survive.
  program.body = program.body.filter((stmt: t.Statement): boolean => {
    if (!t.isVariableDeclaration(stmt) || stmt.kind !== 'const') return true;
    const surviving: t.VariableDeclarator[] = stmt.declarations.filter(
      (d: t.VariableDeclarator): boolean => !(t.isIdentifier(d.id) && dropNames.has(d.id.name)),
    );
    if (surviving.length === stmt.declarations.length) return true; // nothing to drop
    if (surviving.length === 0) return false; // drop the whole statement
    // Mutate in place — keep the statement, just with fewer declarators.
    stmt.declarations = surviving;
    return true;
  });

  // 2. Ensure the virtual:content import (add binding to an existing line, or prepend).
  ensureContentImport(program, binding, builders);

  // `quote: 'single'` only formats nodes recast had to reprint (the new import);
  // untouched nodes keep their original source verbatim.
  let printed: string = recast.print(ast, { quote: 'single' }).code;

  // 3. Prefix extracted `NAME.map` callees → `<binding>.NAME.map`. One hardcoded
  // regex captures every `<ident>.map`; only identifiers in the extracted set are
  // rewritten, and we tally how many times each was hit.
  const extractedSet: Set<string> = new Set(extractedNames);
  const seen: Map<string, number> = new Map<string, number>();
  printed = printed.replace(MAP_CALLEE_PATTERN, (full: string, ident: string): string => {
    if (!extractedSet.has(ident)) return full;
    seen.set(ident, (seen.get(ident) ?? 0) + 1);
    return `${binding}.${ident}.map`;
  });

  // The gate guarantees exactly one `NAME.map(...)` reference in CODE. A count
  // other than 1 means a string/comment occurrence of the same text is in play
  // and a blind rewrite could corrupt it — refuse rather than risk mangling
  // unrelated source. The caller owns persistence and rollback; it must not
  // persist a partial result when this throws.
  for (const name of extractedNames) {
    const count: number = seen.get(name) ?? 0;
    if (count !== 1) {
      throw new Error(
        `unsafe rewrite: expected exactly one \`${name}.map\` in source, found ${count}`,
      );
    }
  }

  return printed;
}

// ── Pure planning (no disk writes) ────────────────────────────────────────────

/**
 * The no-write extraction plan for a single page. `extractedNames` is empty when
 * there is nothing to do (no candidates, all declined, an invalid binding, or
 * everything already lives in the content layer) — in that case `newPageSource`
 * and `content` are absent and callers must not write anything.
 */
/** An extracted array that kept a local `<name>Meta` remainder for retained fields. */
export interface ArrayWithRetained {
  arrayName: string;
  retainedKeys: string[];
}

export interface ExtractionPlan {
  /** `index` → `home`, else the page slug. Always set, even when nothing extracts. */
  binding: string;
  /** Array names that will move into the content layer (empty ⇒ nothing to do). */
  extractedNames: string[];
  /** Candidates declined with a reason (includes invalid-binding declines). */
  skipped: ExtractSkip[];
  /**
   * Extracted arrays that retained non-literal fields in a local `<name>Meta`
   * remainder const. Always present (empty when every extraction was all-literal)
   * so the caller's validation can iterate it unconditionally.
   */
  arraysWithRetained: ArrayWithRetained[];
  /** Content payload keyed by array name, ready for the content layer. Present iff extractedNames is non-empty. */
  content?: Record<string, ExtractedData>;
  /** The recast-rewritten page source. Present iff extractedNames is non-empty. */
  newPageSource?: string;
  /**
   * A hard decline distinct from a per-candidate skip: the addressed extraction
   * cannot proceed even though the array itself is extractable. Currently only
   * `content-key-collision` — the target's content key (`<binding>.<name>`)
   * already belongs to a DIFFERENT declarator's extraction on disk, so writing
   * would clobber it. `extractedNames` is empty when set.
   */
  declineReason?: 'content-key-collision';
}

/**
 * Compute the full extraction plan for a page WITHOUT touching disk. Owns the
 * gate (analyze + binding validity + idempotency) and the recast page rewrite;
 * delegates the snapshot/write/validate/rollback boundary to the caller. Throws
 * only on an unsafe rewrite; callers must not persist a partial result when this
 * throws.
 *
 * When `conformId` is supplied (the id-addressed heal-on-edit path), the plan
 * targets ONLY the array whose declarator loc-id matches — rewriting its binding
 * precisely via scope reference paths so a same-named array elsewhere is never
 * touched. When absent, the S1 module-level batch behavior is unchanged.
 *
 * `existingContentKeys` are the content-layer keys already on disk for this
 * binding (from a prior extraction of a DIFFERENT declarator). Used only in the
 * id-addressed path to decline a `content-key-collision` rather than clobber.
 */
export function planPageExtraction(
  source: string,
  pageRelPath: string,
  conformId?: string,
  // Content-key collision hook: keys already on disk for this binding (from a prior
  // extraction of a DIFFERENT declarator). Always [] today — the on-disk content
  // JSON reader isn't wired yet (follow-up will populate it). Kept as the intended
  // extension point; a test exercises the collision path directly.
  existingContentKeys?: readonly string[],
): ExtractionPlan {
  const binding: string = bindingForPage(pageRelPath);
  const analysis: ExtractAnalysis = analyzeExtractable(source, binding);

  // A page slug that can't form a valid content binding can't be extracted at
  // all — decline every candidate cleanly rather than letting the content layer
  // throw an opaque `invalid-name` downstream.
  if (!CONTENT_BINDING_PATTERN.test(binding)) {
    const reason: string = `page slug '${binding}' is not a valid content binding (must match ${String(CONTENT_BINDING_PATTERN)})`;
    return {
      binding,
      extractedNames: [],
      arraysWithRetained: [],
      skipped: [
        ...analysis.skipped,
        ...analysis.extractions.map((p): ExtractSkip => ({ name: p.arrayName, reason })),
      ],
    };
  }

  if (conformId !== undefined) {
    return planIdAddressed(source, binding, conformId, analysis, existingContentKeys ?? []);
  }

  // Idempotency: when the binding is already imported, drop any candidate whose
  // const is gone — it is already extracted, neither an extraction nor a skip.
  // Narrow to module-level consts only: a function-local `items` binding must
  // not prevent the module-level `items` from being recognised as already-extracted.
  const ast: t.File = parseBabel(source);
  const alreadyImports: boolean = importsBinding(ast, binding);
  const existingConsts: Set<string> = new Set(
    collectArrayConsts(ast)
      .filter((c: ArrayConst): boolean => c.scopeBlockType === 'Program')
      .map((c: ArrayConst): string => c.name),
  );
  // The batch (S1, name-based) retained-split only locates MODULE-LEVEL
  // declarators, so a function-local array with retained fields (e.g. Hot Ham
  // `portfolioItems` — function-local, `icon` retained) cannot be split here and
  // must heal via the id-addressed path (S2). Skip it rather than let the split
  // throw and poison sibling extractions in the same batch. `existingConsts` is
  // exactly the set of module-level array-const names, so absence ⇒ function-local.
  const batchSkips: ExtractSkip[] = [];
  const toExtract: ExtractableArray[] = [];
  for (const p of analysis.extractions) {
    if (alreadyImports && !existingConsts.has(p.arrayName)) continue; // already extracted (idempotent no-op)
    if (p.retainedKeys.length > 0 && !existingConsts.has(p.arrayName)) {
      batchSkips.push({
        name: p.arrayName,
        reason: 'function-local array with retained fields — heal via id-addressed conform (batch path is module-level only)',
      });
      continue;
    }
    toExtract.push(p);
  }

  if (toExtract.length === 0) {
    return { binding, extractedNames: [], arraysWithRetained: [], skipped: [...analysis.skipped, ...batchSkips] };
  }

  const extractedNames: string[] = toExtract.map((p) => p.arrayName);
  const arraysWithRetained: ArrayWithRetained[] = toExtract
    .filter((p: ExtractableArray): boolean => p.retainedKeys.length > 0)
    .map((p: ExtractableArray): ArrayWithRetained => ({
      arrayName: p.arrayName,
      retainedKeys: p.retainedKeys,
    }));
  const content: Record<string, ExtractedData> = {};
  for (const extraction of toExtract) {
    content[extraction.arrayName] = extraction.data;
  }
  const newPageSource: string = rewritePage(source, binding, toExtract);

  return {
    binding,
    extractedNames,
    arraysWithRetained,
    skipped: [...analysis.skipped, ...batchSkips],
    content,
    newPageSource,
  };
}

/**
 * The id-addressed plan: select the single extractable candidate whose declarator
 * loc-id matches `conformId`, decline on collision, and rewrite it binding-precise.
 * A non-matching id is a clean decline (`conform-id-not-found`), not a throw.
 */
function planIdAddressed(
  source: string,
  binding: string,
  conformId: string,
  analysis: ExtractAnalysis,
  existingContentKeys: readonly string[],
): ExtractionPlan {
  const target: ExtractableArray | undefined = analysis.extractions.find(
    (p: ExtractableArray): boolean => p.locId === conformId,
  );
  if (target === undefined) {
    return {
      binding,
      extractedNames: [],
      arraysWithRetained: [],
      skipped: [...analysis.skipped, { name: '(conform-id)', reason: 'conform-id-not-found' }],
    };
  }

  // Content-key collision: the target's key already belongs to a DIFFERENT
  // declarator's extraction on disk. Writing would clobber it — decline instead.
  if (existingContentKeys.includes(target.arrayName)) {
    return {
      binding,
      extractedNames: [],
      arraysWithRetained: [],
      skipped: analysis.skipped,
      declineReason: 'content-key-collision',
    };
  }

  const arraysWithRetained: ArrayWithRetained[] =
    target.retainedKeys.length > 0
      ? [{ arrayName: target.arrayName, retainedKeys: target.retainedKeys }]
      : [];
  const content: Record<string, ExtractedData> = {
    [target.arrayName]: target.data,
  };
  const newPageSource: string = rewritePageBindingPrecise(source, binding, target, conformId);

  return {
    binding,
    extractedNames: [target.arrayName],
    arraysWithRetained,
    skipped: analysis.skipped,
    content,
    newPageSource,
  };
}
