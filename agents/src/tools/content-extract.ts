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

interface ElementCheck {
  ok: boolean;
  reason: string | null;
  value: Record<string, LiteralValue> | null;
}

/** Validate one array element is a flat object literal of serializable values. */
function validateElement(el: t.Node): ElementCheck {
  if (!t.isObjectExpression(el)) {
    return { ok: false, reason: 'array element is not an object literal', value: null };
  }
  const value: Record<string, LiteralValue> = {};
  for (const prop of el.properties) {
    if (t.isSpreadElement(prop) || t.isObjectMethod(prop)) {
      return { ok: false, reason: 'object element contains a spread or method', value: null };
    }
    if (prop.computed) {
      return { ok: false, reason: 'object element has a computed key', value: null };
    }
    const key: string | null = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null;
    if (key === null) {
      return { ok: false, reason: 'object element has a non-literal key', value: null };
    }
    const propValue: t.Node = prop.value;
    if (t.isArrayExpression(propValue) || t.isObjectExpression(propValue)) {
      return { ok: false, reason: `property "${key}" holds a nested array/object (non-flat)`, value: null };
    }
    if (t.isJSXElement(propValue) || t.isJSXFragment(propValue)) {
      return { ok: false, reason: `property "${key}" holds JSX (non-serializable)`, value: null };
    }
    if (t.isFunction(propValue) || t.isArrowFunctionExpression(propValue)) {
      return { ok: false, reason: `property "${key}" holds a function (non-serializable)`, value: null };
    }
    if (!literalKind(propValue)) {
      return {
        ok: false,
        reason: `property "${key}" holds a non-serializable value (identifier/expression, not a literal)`,
        value: null,
      };
    }
    value[key] = literalValue(propValue);
  }
  return { ok: true, reason: null, value };
}

interface ArrayShapeCheck {
  ok: boolean;
  reason: string | null;
  data: Record<string, LiteralValue>[] | null;
}

/** Validate every element of a module-level array literal and extract its data. */
function validateArray(arrayExpr: t.ArrayExpression): ArrayShapeCheck {
  if (arrayExpr.elements.length === 0) {
    return { ok: false, reason: 'array is empty (no element shape to infer)', data: null };
  }
  const data: Record<string, LiteralValue>[] = [];
  for (const el of arrayExpr.elements) {
    if (el === null) {
      return { ok: false, reason: 'array contains a hole/elision', data: null };
    }
    if (t.isSpreadElement(el)) {
      return { ok: false, reason: 'array uses a spread element', data: null };
    }
    const check: ElementCheck = validateElement(el);
    if (!check.ok || check.value === null) {
      return { ok: false, reason: check.reason, data: null };
    }
    data.push(check.value);
  }
  return { ok: true, reason: null, data };
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
    extractions.push({ arrayName: candidate.name, data: shape.data });
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

// Matches `<identifier>.map` that is not already part of a longer member chain
// (no preceding word char or `.`). Hardcoded — not built per name — so there is
// no dynamic-RegExp/ReDoS surface; the captured identifier is filtered in JS.
const MAP_CALLEE_PATTERN: RegExp = /(?<![\w.])([A-Za-z_$][\w$]*)\.map\b/g;

/**
 * Rewrite the page so extracted arrays read from `virtual:content`: ensure the
 * `import { <binding> } from 'virtual:content'` line, delete each extracted
 * `const NAME = [...]`, and rewrite the `NAME.map` callee to `<binding>.NAME.map`.
 *
 * The import-add and const-removal are top-level statement edits, which recast
 * reprints cleanly while preserving every untouched node verbatim. The `.map`
 * rename is applied as a precise text substitution on the printed source rather
 * than as an AST mutation: mutating a `MemberExpression` deep inside JSX makes
 * recast reprint the whole enclosing element and drop blank lines between JSX
 * siblings. The substitution is safe because the gate guarantees each extracted
 * `NAME` is referenced ONLY by exactly one `NAME.map(...)`; the `(?<![\w.])`
 * lookbehind keeps it from matching an already-prefixed `<binding>.NAME.map`
 * (idempotency) or a longer identifier ending in `NAME`.
 */
function rewritePage(source: string, binding: string, extractedNames: string[]): string {
  const ast: recast.types.ASTNode = recast.parse(source, { parser: recastBabelTs });
  const extracted: Set<string> = new Set(extractedNames);
  const builders: typeof recast.types.builders = recast.types.builders;
  const program: t.Program = (ast as unknown as { program: t.Program }).program;

  // 1. Drop extracted const declarations.
  program.body = program.body.filter((stmt: t.Statement): boolean => {
    if (!t.isVariableDeclaration(stmt) || stmt.kind !== 'const') return true;
    return !stmt.declarations.some((d) => t.isIdentifier(d.id) && extracted.has(d.id.name));
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
export interface ExtractionPlan {
  /** `index` → `home`, else the page slug. Always set, even when nothing extracts. */
  binding: string;
  /** Array names that will move into the content layer (empty ⇒ nothing to do). */
  extractedNames: string[];
  /** Candidates declined with a reason (includes invalid-binding declines). */
  skipped: ExtractSkip[];
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
    return { binding, extractedNames: [], skipped: analysis.skipped };
  }

  const extractedNames: string[] = toExtract.map((p) => p.arrayName);
  const content: Record<string, Record<string, LiteralValue>[]> = {};
  for (const extraction of toExtract) {
    content[extraction.arrayName] = extraction.data;
  }
  const newPageSource: string = rewritePage(source, binding, extractedNames);

  return { binding, extractedNames, skipped: analysis.skipped, content, newPageSource };
}
