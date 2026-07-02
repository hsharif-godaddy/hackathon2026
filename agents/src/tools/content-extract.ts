import path from 'node:path';
import { parse as babelParse } from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import traverseDefault from '@babel/traverse';
import * as t from '@babel/types';
import * as recast from 'recast';
import * as recastBabelTs from 'recast/parsers/babel-ts.js';

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

export interface ExtractableArray {
  arrayName: string;
  data: Record<string, LiteralValue>[];
  retainedKeys: string[];
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
  extractable: Record<string, LiteralValue> | null;
  retainedKeys: string[];
}

/**
 * Partition one array element's fields into extractable literals (lifted to the
 * content layer) and retained non-literal refs (e.g. `icon: Target`, left local).
 * Nested array/object, JSX, functions, spreads, methods, and computed/non-literal
 * keys remain HARD skips of the whole array — deferred to a later slice.
 */
function validateElement(el: t.Node): ElementSplit {
  if (!t.isObjectExpression(el)) {
    return { ok: false, reason: 'array element is not an object literal', extractable: null, retainedKeys: [] };
  }
  const extractable: Record<string, LiteralValue> = {};
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
    if (t.isArrayExpression(propValue) || t.isObjectExpression(propValue)) {
      return {
        ok: false,
        reason: `property "${key}" holds a nested array/object (non-flat)`,
        extractable: null,
        retainedKeys: [],
      };
    }
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
    } else if (t.isIdentifier(propValue) || (t.isMemberExpression(propValue) && !propValue.computed)) {
      // Component/const ref (e.g. `icon: Target`) — retained locally, not lifted.
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
  data: Record<string, LiteralValue>[] | null;
  retainedKeys: string[];
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
  const data: Record<string, LiteralValue>[] = [];
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
 * Inspect every reference to `name`. The only allowed use is being the callee
 * object of `name.map(...)`. Anything else (index, prop-drill, spread, `.length`,
 * passed as an argument) disqualifies. A `name` binding shadowed by an inner
 * scope (e.g. a nested map param) is not counted as a reference to the const.
 */
function analyzeReferences(ast: t.File, name: string): ReferenceCheck {
  let mapCount: number = 0;
  let badReason: string | null = null;

  traverse(ast, {
    Identifier(refPath: NodePath<t.Identifier>): void {
      if (refPath.node.name !== name) return;
      if (!refPath.isReferencedIdentifier()) return;
      // Skip the binding id in `const NAME = ...`.
      if (refPath.parentPath?.isVariableDeclarator({ id: refPath.node })) return;
      // Only references that resolve to the module-level binding count; a shadowed
      // `name` (nested-map param) resolves to a different binding and is ignored.
      const binding: ReturnType<typeof refPath.scope.getBinding> = refPath.scope.getBinding(name);
      if (binding && binding.scope.block.type !== 'Program') return;

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
}

/** Find module-level `const NAME = [ ... ]` declarations (Program body only). */
function collectModuleLevelArrayConsts(ast: t.File): ArrayConst[] {
  const out: ArrayConst[] = [];
  for (const stmt of ast.program.body) {
    if (!t.isVariableDeclaration(stmt) || stmt.kind !== 'const') continue;
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id) && decl.init && t.isArrayExpression(decl.init)) {
        out.push({ name: decl.id.name, init: decl.init });
      }
    }
  }
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

  for (const candidate of collectModuleLevelArrayConsts(ast)) {
    const shape: ArrayShapeCheck = validateArray(candidate.init);
    if (!shape.ok || shape.data === null) {
      skipped.push({ name: candidate.name, reason: shape.reason ?? 'unknown' });
      continue;
    }
    const refs: ReferenceCheck = analyzeReferences(ast, candidate.name);
    if (refs.reason) {
      skipped.push({ name: candidate.name, reason: refs.reason });
      continue;
    }
    extractions.push({ arrayName: candidate.name, data: shape.data, retainedKeys: shape.retainedKeys });
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

/** A page's content binding: `index` → `home`, otherwise the file's slug. */
function bindingForPage(pageRelPath: string): string {
  const base: string = path.basename(pageRelPath).replace(/\.(tsx|jsx|ts|js)$/, '');
  return base === 'index' ? 'home' : base;
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

  // Uniquify the remainder name against the current module scope so an existing
  // `const statsMeta` or `import { statsMeta }` doesn't produce a duplicate
  // lexical binding (a scope error that @babel/parser may not flag).
  const moduleScope: Set<string> = collectModuleScopeNames(program);
  const resolvedMetaName: string = uniqueMetaName(plan.arrayName, moduleScope);

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

  redirectRetainedReads(program, plan, retained, builders, resolvedMetaName);
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
 * Redirect every retained-field read inside the array's `.map` callback so the
 * page keeps rendering identically after the literal fields move to the content
 * layer. Two read positions:
 *
 *  - Expression position (`{s.icon}`, `className={s.icon}`, `icon={s.icon}`): the
 *    `<param>.<key>` MemberExpression is rewritten in place to
 *    `<name>Meta[<idx>].<key>`.
 *  - JSX-tag position (`<s.icon/>`, a JSXMemberExpression tag name — the common
 *    lucide pattern): `statsMeta[i].icon` is not a valid JSX tag, so we hoist a
 *    uniquely-named `const <Cap> = <name>Meta[<idx>].<key>` at the top of the
 *    callback and rewrite the tag to `<Cap/>`. One binding per retained key used
 *    as a tag.
 *
 * Behavior-preservation invariant: we split ONE source array element-wise, so
 * `<name>Meta[i]` is the same element index as `content.<name>[i]` (same order,
 * same length). `<s.icon/>` with `s.icon === Target` rendered `<Target/>`; after
 * conform `const Icon = statsMeta[i].icon (=== Target)` + `<Icon/>` renders the
 * identical element.
 *
 * Throws the shared "unsafe rewrite" error (→ conform declines, element stays
 * shut off) when the callback is not an inline arrow/function, has no item
 * identifier param, or has an unresolvable index param.
 */
function redirectRetainedReads(
  program: t.Program,
  plan: ExtractableArray,
  retained: Set<string>,
  builders: typeof recast.types.builders,
  resolvedMetaName?: string,
): void {
  const mapCall: t.CallExpression | null = findMapCall(program, plan.arrayName);
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
  content?: Record<string, Record<string, LiteralValue>[]>;
  /** The recast-rewritten page source. Present iff extractedNames is non-empty. */
  newPageSource?: string;
}

/**
 * Compute the full extraction plan for a page WITHOUT touching disk. Owns the
 * gate (analyze + binding validity + idempotency) and the recast page rewrite;
 * delegates the snapshot/write/validate/rollback boundary to the caller. Throws
 * only on an unsafe rewrite; callers must not persist a partial result when this
 * throws.
 */
export function planPageExtraction(source: string, pageRelPath: string): ExtractionPlan {
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

  // Idempotency: when the binding is already imported, drop any candidate whose
  // const is gone — it is already extracted, neither an extraction nor a skip.
  const ast: t.File = parseBabel(source);
  const alreadyImports: boolean = importsBinding(ast, binding);
  const existingConsts: Set<string> = new Set(
    collectModuleLevelArrayConsts(ast).map((c) => c.name),
  );
  const toExtract: ExtractableArray[] = analysis.extractions.filter(
    (p) => !(alreadyImports && !existingConsts.has(p.arrayName)),
  );

  if (toExtract.length === 0) {
    return { binding, extractedNames: [], arraysWithRetained: [], skipped: analysis.skipped };
  }

  const extractedNames: string[] = toExtract.map((p) => p.arrayName);
  const arraysWithRetained: ArrayWithRetained[] = toExtract
    .filter((p: ExtractableArray): boolean => p.retainedKeys.length > 0)
    .map((p: ExtractableArray): ArrayWithRetained => ({
      arrayName: p.arrayName,
      retainedKeys: p.retainedKeys,
    }));
  const content: Record<string, Record<string, LiteralValue>[]> = {};
  for (const extraction of toExtract) {
    content[extraction.arrayName] = extraction.data;
  }
  const newPageSource: string = rewritePage(source, binding, toExtract);

  return {
    binding,
    extractedNames,
    arraysWithRetained,
    skipped: analysis.skipped,
    content,
    newPageSource,
  };
}
