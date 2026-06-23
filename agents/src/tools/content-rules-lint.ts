import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import traverseDefault from '@babel/traverse';
import type {
  ImportDeclaration,
  VariableDeclarator,
  CallExpression,
  JSXText,
  JSXExpressionContainer,
  JSXOpeningElement,
  ObjectExpression,
  Expression,
  Node,
} from '@babel/types';
import { traverseFast } from '@babel/types';
import { Logger } from '../logging/index.js';

// Babel's traverse default-export has a CJS interop quirk under ESM bundlers.

const traverse: any = (traverseDefault as any).default ?? traverseDefault;

const logger = Logger.create({ component: 'content-rules-lint' });
const CONTENT_MODULE = 'virtual:content';

export type RuleId =
  | 'destructured-content-import'
  | 'component-imports-content'
  | 'map-without-list-context'
  | 'missed-content-opportunity'
  | 'local-content-object'
  | 'direct-content-import'
  | 'content-prop-drill'
  | 'content-derived-array-map';

/**
 * Threshold for the "missed-content-opportunity" heuristic.
 * If a page file has this many or more user-copy-shaped JSX text nodes AND
 * no import from `virtual:content`, the rule fires. Tuned to catch pages
 * the agent wrote with inline hardcoded copy (hero taglines, CTAs, feature
 * blurbs) while avoiding false positives on layout/dev scaffolding.
 */
const MISSED_OPPORTUNITY_MIN_INLINE_STRINGS = 3;
const MISSED_OPPORTUNITY_MIN_STRING_LENGTH = 10;
const LOCAL_CONTENT_OBJECT_MIN_STRING_LEAVES = 3;
const DIRECT_CONTENT_PATH_RE = /^(@\/content(?:\/|$)|\.\.?\/(?:.*\/)?content(?:\/|$))/;

export function isDirectContentPath(src: string): boolean {
  return DIRECT_CONTENT_PATH_RE.test(src);
}

const DERIVE_METHODS: ReadonlySet<string> = new Set(['find', 'filter', 'slice', 'flatMap']);

/**
 * True if `init`'s subtree reads a `virtual:content` binding AND applies an
 * array-producing derive (`.find`/`.filter`/`.slice`/`.flatMap`, or a computed
 * member access) — e.g. `home.menu.categories.find(...)?.items ?? []`. Such a
 * value can't be statically attributed, so mapping it renders non-editable items.
 */
function isContentDerivedInit(init: Node, contentBindings: ReadonlySet<string>): boolean {
  let readsContent = false;
  let hasDerive = false;
  traverseFast(init, (n: Node) => {
    if (n.type === 'Identifier' && contentBindings.has(n.name)) {
      readsContent = true;
    } else if (
      (n.type === 'CallExpression' || n.type === 'OptionalCallExpression') &&
      (n.callee.type === 'MemberExpression' || n.callee.type === 'OptionalMemberExpression') &&
      n.callee.property.type === 'Identifier' &&
      DERIVE_METHODS.has(n.callee.property.name)
    ) {
      hasDerive = true;
    } else if (
      (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') &&
      n.computed
    ) {
      hasDerive = true;
    }
  });
  return readsContent && hasDerive;
}

/** True if `call` is `<x>.map(cb)` whose callback renders a JSX leaf referencing
 *  the callback's first param (`{item.field}`) — i.e. it renders content. */
function mapCallbackRendersContentLeaf(call: CallExpression): boolean {
  const cb = call.arguments[0];
  if (!cb || (cb.type !== 'ArrowFunctionExpression' && cb.type !== 'FunctionExpression')) return false;
  const param = cb.params[0];
  if (!param || param.type !== 'Identifier') return false;
  const paramName = param.name;
  let found = false;
  traverseFast(cb.body, (n: Node) => {
    if (
      n.type === 'JSXExpressionContainer' &&
      (n.expression.type === 'MemberExpression' || n.expression.type === 'OptionalMemberExpression')
    ) {
      let cur: Node = n.expression;
      while (cur.type === 'MemberExpression' || cur.type === 'OptionalMemberExpression') cur = cur.object;
      if (cur.type === 'Identifier' && cur.name === paramName) found = true;
    }
  });
  return found;
}

/**
 * True when a VariableDeclarator's declaration sits somewhere we treat as a
 * local content-object scope: module top-level (`const data = {…}`), an
 * `export const data = {…}`, or inside a function/block body
 * (`function Home() { const data = {…} }` — the dominant agent-generated shape).
 */
function isLocalContentObjectScope(p: NodePath<VariableDeclarator>): boolean {
  const container = p.parentPath?.parentPath;
  return Boolean(
    container?.isProgram() ||
      container?.isExportNamedDeclaration() ||
      container?.isBlockStatement(),
  );
}

function countStringLeaves(node: ObjectExpression): number {
  let count = 0;
  for (const prop of node.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    if (prop.value.type === 'StringLiteral') {
      count++;
    } else if (prop.value.type === 'ObjectExpression') {
      count += countStringLeaves(prop.value);
    }
  }
  return count;
}

export interface RuleViolation {
  rule: RuleId;
  file: string;
  line?: number;
  message: string;
}

interface Options {
  /** Roots inside the app to scan (relative to appDir). Defaults to common page/component dirs. */
  scanRoots?: string[];
  /** Components directory suffix; imports from `virtual:content` inside are flagged. */
  componentsRoot?: string;
}

/**
 * Static linter for the content-layer rules. Given an app directory, walks
 * .tsx/.ts files under the configured scan roots and reports violations of:
 *  - destructured-content-import: destructuring a content binding
 *  - component-imports-content: component file imports from `virtual:content`
 *  - map-without-list-context: `.map()` over a content binding without
 *    a surrounding `ContentListContext` (heuristic)
 *  - missed-content-opportunity: page has many inline text strings but no
 *    `virtual:content` import
 *  - local-content-object: page uses a local object literal for user copy
 *    instead of the content layer
 *  - direct-content-import: imports from a file path instead of `virtual:content`
 *  - content-prop-drill: content-rooted value passed as a prop into a component,
 *    making the field uneditable (source-mapper can't attribute it)
 *
 * Returns an empty array on compliance. Safe to run on generated apps after
 * scaffolding to catch common mistakes.
 */
export async function checkContentRules(
  appDir: string,
  options: Options = {},
): Promise<RuleViolation[]> {
  const scanRoots = options.scanRoots ?? ['src/pages', 'src/components', 'src/layouts'];
  const componentsRoot = options.componentsRoot ?? 'src/components';
  const pagesRoot = 'src/pages';

  const violations: RuleViolation[] = [];
  const filesScanned = new Set<string>();

  for (const root of scanRoots) {
    const abs = path.join(appDir, root);
    await walkTsx(abs, async (file) => {
      if (filesScanned.has(file)) return;
      filesScanned.add(file);
      const rel = path.relative(appDir, file);
      let source: string;
      try {
        source = await fs.readFile(file, 'utf8');
      } catch (err) {
        logger.warn('content-rules-lint.readFile-failed', { file: rel, error: String(err) });
        return;
      }
      collectViolations(source, rel, componentsRoot, pagesRoot, violations);
    });
  }

  return violations;
}

/**
 * Lint a single source file in isolation. Used both by the directory-walking
 * `checkContentRules` and by the post-write hook on the file-edit tool path
 * (so agent file writes surface content violations in the tool result).
 */
export function checkContentRulesForFile(
  source: string,
  relPath: string,
  options: { componentsRoot?: string; pagesRoot?: string } = {},
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const componentsRoot = options.componentsRoot ?? 'src/components';
  const pagesRoot = options.pagesRoot ?? 'src/pages';
  collectViolations(source, relPath, componentsRoot, pagesRoot, violations);
  return violations;
}

function collectViolations(
  source: string,
  relPath: string,
  componentsRoot: string,
  pagesRoot: string,
  violations: RuleViolation[],
): void {
  // Framework pages — `_`-prefixed files like the template's `_404.tsx` — ship
  // with v8 and legitimately hold hardcoded chrome copy ("Page not found",
  // "Go Back"). They are not content pages, so exempt them from every content
  // rule. (v8 is Vite + react-router with explicit routes.tsx, so `_404` is the
  // only such page today; the prefix rule covers any future framework page.)
  // Match roots as full path segments (trailing '/') so `src/pagesv2/...` and
  // `src/componentsv2/...` aren't misclassified as page/component files. A file
  // is always under the dir, never equal to it, so the trailing slash is safe.
  const isUnderRoot = (root: string): boolean => relPath.startsWith(`${root}/`);

  const baseName = relPath.split('/').pop() ?? relPath;
  if (isUnderRoot(pagesRoot) && baseName.startsWith('_')) {
    return;
  }

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
  } catch (err) {
    if (err instanceof SyntaxError) return;
    logger.warn('content-rules-lint.parse-unexpected', { file: relPath, error: String(err) });
    return;
  }

  const contentBindings = new Set<string>();
  const isComponentFile = isUnderRoot(componentsRoot);
  const isPageFile = isUnderRoot(pagesRoot);
  let inlineUserCopyCount = 0;

  // local-content-object tracking: binding name → string leaf count
  const localContentObjects = new Map<string, number>();
  const jsxReferencedBindings = new Set<string>();

  // content-derived-array-map: locals assigned from a content collection via a
  // derive operation (find/filter/slice/computed) — mapping these loses attribution.
  const contentDerivedLocals = new Set<string>();

  // content-prop-drill: tracks .map() callback params whose iterated value is
  // content-rooted, so we can detect when those params are drilled into components.
  const contentMapParams = new Set<string>();
  // Maps each content-rooted .map() call to the param name it pushed, so exit()
  // pops exactly what enter() added — without monkey-patching the path node.
  const pushedMapParam = new WeakMap<CallExpression, string>();

  /**
   * Walk a member/identifier chain and return the root identifier name.
   * Returns null if the chain contains a computed property or non-identifier
   * hop (e.g. a call expression), which we cannot safely attribute.
   */
  function rootIdentifier(node: Node): string | null {
    let cur: Node = node;
    while (cur.type === 'MemberExpression') {
      if (cur.computed) return null;
      cur = cur.object;
    }
    return cur.type === 'Identifier' ? cur.name : null;
  }

  /**
   * Returns true if `node` is "content-rooted": its root identifier is either
   * a direct virtual:content binding or a .map() callback param that itself
   * iterates over a content-rooted chain.
   */
  function isContentRooted(node: Expression): boolean {
    const root = rootIdentifier(node);
    if (root === null) return false;
    return contentBindings.has(root) || contentMapParams.has(root);
  }

  try {
    traverse(ast, {
      ImportDeclaration(p: NodePath<ImportDeclaration>) {
        const src = p.node.source.value;

        if (src === CONTENT_MODULE) {
          if (isComponentFile) {
            violations.push({
              rule: 'component-imports-content',
              file: relPath,
              line: p.node.loc?.start.line,
              message: `component file imports from "${CONTENT_MODULE}" — pages should pass content as props`,
            });
          }
          for (const spec of p.node.specifiers) {
            if (spec.type === 'ImportSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
              contentBindings.add(spec.local.name);
            }
          }
          return;
        }

        if (isDirectContentPath(src)) {
          violations.push({
            rule: 'direct-content-import',
            file: relPath,
            line: p.node.loc?.start.line,
            message:
              `imports from "${src}" instead of "${CONTENT_MODULE}". ` +
              `Content must come from \`import { <key> } from '${CONTENT_MODULE}'\` ` +
              `to be inline-editable — direct imports bypass the content layer.`,
          });
        }
      },

      VariableDeclarator(p: NodePath<VariableDeclarator>) {
        if (!p.node.init) return;

        // Track top-level object literals with string leaves (local-content-object)
        if (
          isPageFile &&
          p.node.id.type === 'Identifier' &&
          p.node.init.type === 'ObjectExpression' &&
          isLocalContentObjectScope(p)
        ) {
          const leaves = countStringLeaves(p.node.init);
          if (leaves >= LOCAL_CONTENT_OBJECT_MIN_STRING_LEAVES) {
            localContentObjects.set(p.node.id.name, leaves);
          }
        }

        // content-derived-array-map (part 1): record locals assigned from a
        // derived content collection (find/filter/slice/computed) for the map check.
        if (p.node.id.type === 'Identifier' && p.node.init && isContentDerivedInit(p.node.init, contentBindings)) {
          contentDerivedLocals.add(p.node.id.name);
        }

        // Destructured content bindings
        if (p.node.init.type !== 'Identifier') return;
        if (!contentBindings.has(p.node.init.name)) return;
        if (p.node.id.type === 'ObjectPattern' || p.node.id.type === 'ArrayPattern') {
          violations.push({
            rule: 'destructured-content-import',
            file: relPath,
            line: p.node.loc?.start.line,
            message: `destructured from content binding "${p.node.init.name}" — use direct member access instead`,
          });
        }
      },

      CallExpression: {
        enter(p: NodePath<CallExpression>) {
          const callee = p.node.callee;
          if (callee.type !== 'MemberExpression') return;
          if (callee.property.type !== 'Identifier' || callee.property.name !== 'map') return;

          // Resolve the root of the chain being mapped over.
          // Handles both `products.map` and `home.menu.categories.map`.
          const chainRoot = rootIdentifier(callee.object);

          // content-derived-array-map (part 2): mapping a content collection that
          // was derived into a local → items lose attribution, not inline-editable.
          if (chainRoot !== null && contentDerivedLocals.has(chainRoot) && mapCallbackRendersContentLeaf(p.node)) {
            violations.push({
              rule: 'content-derived-array-map',
              file: relPath,
              line: p.node.loc?.start.line,
              message:
                `${chainRoot}.map(...) iterates a content collection derived into a local ` +
                `(e.g. via .find()/.filter()/.slice()) — its items have no content key and won't be inline-editable. ` +
                `Render a direct chain instead (nest categories.map(cat => cat.items.map(item => …))) ` +
                `and drive tabs/filters with CSS visibility (or a conditional className), not by filtering content into a local.`,
            });
          }

          // map-without-list-context: only fires for direct contentBindings root
          // (the simple case the original rule detected)
          if (chainRoot !== null && contentBindings.has(chainRoot) && callee.object.type === 'Identifier') {
            let cur: NodePath | null = p;
            let wrapped = false;
            while (cur) {
              const node = cur.node;
              if (node.type === 'JSXElement') {
                const openingName = node.openingElement.name;
                if (openingName.type === 'JSXIdentifier' && openingName.name === 'ContentListContext') {
                  wrapped = true;
                  break;
                }
              }
              cur = cur.parentPath;
            }
            if (!wrapped) {
              violations.push({
                rule: 'map-without-list-context',
                file: relPath,
                line: p.node.loc?.start.line,
                message: `${callee.object.name}.map(...) is not wrapped in <ContentListContext> — items will render but won't be editable`,
              });
            }
          }

          // content-prop-drill: track .map() callback params whose iterated
          // chain is content-rooted (direct binding OR already-on-stack param).
          if (chainRoot !== null && (contentBindings.has(chainRoot) || contentMapParams.has(chainRoot))) {
            const args = p.node.arguments;
            const cb = args[0];
            if (cb !== undefined) {
              const firstParam =
                cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression'
                  ? cb.params[0]
                  : null;
              if (firstParam?.type === 'Identifier') {
                contentMapParams.add(firstParam.name);
                pushedMapParam.set(p.node, firstParam.name);
              }
            }
          }
        },
        exit(p: NodePath<CallExpression>) {
          const param = pushedMapParam.get(p.node);
          if (param !== undefined) {
            contentMapParams.delete(param);
          }
        },
      },

      JSXOpeningElement(p: NodePath<JSXOpeningElement>) {
        const name = p.node.name;
        // Only check component tags (uppercase JSXIdentifier). Skip member
        // expressions (motion.div) and lowercase native tags.
        if (name.type !== 'JSXIdentifier') return;
        const firstChar = name.name[0];
        if (firstChar === undefined || firstChar !== firstChar.toUpperCase() || firstChar === firstChar.toLowerCase()) return;

        for (const attr of p.node.attributes) {
          if (attr.type !== 'JSXAttribute') continue;
          // key prop is never an editable content field — skip it
          if (attr.name.type === 'JSXIdentifier' && attr.name.name === 'key') continue;
          if (!attr.value || attr.value.type !== 'JSXExpressionContainer') continue;
          const expr = attr.value.expression;
          if (expr.type === 'JSXEmptyExpression') continue;
          if (isContentRooted(expr as Expression)) {
            const attrName =
              attr.name.type === 'JSXIdentifier' ? attr.name.name : '(unknown)';
            violations.push({
              rule: 'content-prop-drill',
              file: relPath,
              line: p.node.loc?.start.line,
              message:
                `<${name.name} ${attrName}={…}> receives a content-rooted value as a prop — ` +
                `source-mapper cannot attribute it and the field becomes uneditable. ` +
                `Render the content inline on the page (inline the .map() body and use {…} leaf expressions) ` +
                `instead of passing content into a component.`,
            });
          }
        }
      },

      JSXExpressionContainer(p: NodePath<JSXExpressionContainer>) {
        if (!isPageFile) return;
        const expr = p.node.expression;
        if (expr.type === 'JSXEmptyExpression') return;
        // Walk MemberExpression chain to find root identifier
        let cur = expr;
        while (cur.type === 'MemberExpression') cur = cur.object as typeof cur;
        if (cur.type === 'Identifier' && localContentObjects.has(cur.name)) {
          jsxReferencedBindings.add(cur.name);
        }
      },

      JSXText(p: NodePath<JSXText>) {
        if (!isPageFile) return;
        const trimmed = p.node.value.trim();
        if (trimmed.length < MISSED_OPPORTUNITY_MIN_STRING_LENGTH) return;
        inlineUserCopyCount++;
      },
    });
  } catch (err) {
    logger.warn('content-rules-lint.traverse-failed', { file: relPath, error: String(err) });
    return;
  }

  // Post-traversal: page files with many inline user-copy strings but no
  // virtual:content import likely skipped `content_scaffold` entirely.
  if (
    isPageFile &&
    contentBindings.size === 0 &&
    inlineUserCopyCount >= MISSED_OPPORTUNITY_MIN_INLINE_STRINGS
  ) {
    violations.push({
      rule: 'missed-content-opportunity',
      file: relPath,
      message:
        `page has ${inlineUserCopyCount} inline text strings but no import from "${CONTENT_MODULE}". ` +
        `User-visible copy must go through the content layer to be inline-editable — ` +
        `call \`content_scaffold\` to create a content root and update this file to import { <key> } from 'virtual:content'.`,
    });
  }

  if (isPageFile) {
    for (const [name, leaves] of localContentObjects) {
      if (!jsxReferencedBindings.has(name)) continue;
      violations.push({
        rule: 'local-content-object',
        file: relPath,
        message:
          `page extracts user-visible text into local object "${name}" (${leaves} string values) instead of using the content layer — ` +
          `content must come from '${CONTENT_MODULE}' to be inline-editable. ` +
          `Call \`content_scaffold\` first, then replace the local object with \`import { <key> } from '${CONTENT_MODULE}'\`.`,
      });
    }
  }
}

async function walkTsx(dir: string, visit: (file: string) => Promise<void>): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('content-rules-lint.walkTsx.readdir-failed', { dir, error: String(err) });
    }
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkTsx(abs, visit);
    } else if (entry.isFile() && (abs.endsWith('.tsx') || abs.endsWith('.ts'))) {
      await visit(abs);
    }
  }
}
