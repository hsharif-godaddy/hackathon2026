import type { PluginObj, PluginPass, types, NodePath } from '@babel/core';
import type { JSXElement, Program, ImportDeclaration, CallExpression, Expression } from '@babel/types';
import {
  buildGuardExpression,
  ensureFormattedBoundTextImport,
  getIntrinsicTextTagName,
  hashExpression,
  isFormatBoundTextRuntimeAvailable,
  type BoundTextCandidate,
} from './format-bound-text.js';

interface PluginOptions {
  excludePaths?: string[];
  formatBoundTextRuntime?: boolean;
  formatBoundTextRoot?: string;
}

interface AncestorFrame {
  tagName: string;
  ownIndex: number;
  sameTagChildCount: Map<string, number>;
}

type PluginState = PluginPass & {
  opts?: PluginOptions;
  contentBindings: Set<string>;
  mapStack: IterationFrame[];
  mapFrames: WeakMap<CallExpression, IterationFrame>;
  genericMapDepth: number;
  genericMapFrames: WeakSet<CallExpression>;
  ancestorStack: AncestorFrame[];
  programPath: NodePath<Program> | null;
  formatBoundTextRuntimeAvailable: boolean;
};

interface IterationFrame {
  paramName: string;
  pathBase: string;
}

const CONTENT_MODULE = 'virtual:content';

export function hashStructuralKey(key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) + key.charCodeAt(i);
    hash |= 0; // Force 32-bit integer for overflow semantics
  }
  return (hash >>> 0).toString(16).slice(-6).padStart(6, '0');
}

export default function jsxSourceMapper(babel: { types: typeof types }): PluginObj<PluginState> {
  const t = babel.types;

  function hasAttr(attrs: JSXElement['openingElement']['attributes'], name: string): boolean {
    return attrs.some(
      (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === name,
    );
  }

  function getJsxTagName(opening: JSXElement['openingElement']): string {
    if (t.isJSXIdentifier(opening.name)) return opening.name.name;
    if (t.isJSXMemberExpression(opening.name)) {
      const parts: string[] = [];
      let cur: types.JSXMemberExpression | types.JSXIdentifier = opening.name;
      while (t.isJSXMemberExpression(cur)) {
        parts.unshift(cur.property.name);
        cur = cur.object;
      }
      if (t.isJSXIdentifier(cur)) parts.unshift(cur.name);
      return parts.join('.');
    }
    if (t.isJSXNamespacedName(opening.name)) {
      return `${opening.name.namespace.name}:${opening.name.name.name}`;
    }
    return 'unknown';
  }

  function normalizeFileName(raw: string): string {
    const normalized = raw.replace(/\\/g, '/');
    const srcIdx = normalized.indexOf('/src/');
    if (srcIdx !== -1) return normalized.slice(srcIdx + 1);
    const appIdx = normalized.indexOf('/app/');
    if (appIdx !== -1) return normalized.slice(appIdx + 1);
    return normalized;
  }

  // A "native-tag parent" is a lowercase JSX identifier (html element like
  // <span>, <h1>) or a member expression (like <motion.h1>). Capital-letter
  // JSX identifiers are React components — their `children` shape is part
  // of their prop contract, so we don't inject wrappers there.
  function isNativeTagParent(opening: JSXElement['openingElement']): boolean {
    if (t.isJSXMemberExpression(opening.name)) {
      // motion.h1 (lowercase root) → native, Heading.Primary (uppercase) → component
      let root: types.JSXMemberExpression['object'] = opening.name;
      while (t.isJSXMemberExpression(root)) root = root.object;
      return t.isJSXIdentifier(root) && /^[a-z]/.test(root.name);
    }
    if (t.isJSXIdentifier(opening.name)) {
      return /^[a-z]/.test(opening.name.name);
    }
    return false;
  }

  // Whitespace-only JSX text and empty expression containers ({/* comments */})
  // are structural noise — not meaningful children for the mixed-child gate.
  function isMeaningfulChild(c: JSXElement['children'][number]): boolean {
    if (t.isJSXText(c) && c.value.trim() === '') return false;
    if (t.isJSXExpressionContainer(c) && t.isJSXEmptyExpression(c.expression)) return false;
    return true;
  }

  // Walk a MemberExpression / Identifier chain and return `["root", "a", "b"]`
  // iff every hop is an identifier-typed, non-computed property access.
  // Returns null for any unsupported shape (computed indices, destructuring, etc.).
  function readChain(node: Expression): string[] | null {
    const parts: string[] = [];
    let cur: Expression = node;
    while (t.isMemberExpression(cur)) {
      if (cur.computed) return null;
      if (!t.isIdentifier(cur.property)) return null;
      parts.unshift(cur.property.name);
      cur = cur.object as Expression;
    }
    if (!t.isIdentifier(cur)) return null;
    parts.unshift(cur.name);
    return parts;
  }

  // If `node` is a `.map()` call on a content-rooted chain, return the frame
  // metadata; otherwise null.
  function analyzeMapCall(node: CallExpression, s: PluginState): IterationFrame | null {
    if (!t.isMemberExpression(node.callee)) return null;
    if (node.callee.computed) return null;
    if (!t.isIdentifier(node.callee.property, { name: 'map' })) return null;
    const chain = readChain(node.callee.object as Expression);
    if (!chain) return null;
    if (!s.contentBindings.has(chain[0])) return null;
    const cb = node.arguments[0];
    if (!cb || (!t.isArrowFunctionExpression(cb) && !t.isFunctionExpression(cb))) return null;
    const first = cb.params[0];
    if (!t.isIdentifier(first)) return null;
    return { paramName: first.name, pathBase: chain.join('.') };
  }

  function isAnyMapCall(node: CallExpression): boolean {
    return t.isMemberExpression(node.callee) &&
      !node.callee.computed &&
      t.isIdentifier(node.callee.property, { name: 'map' }) &&
      node.arguments.length > 0 &&
      (t.isArrowFunctionExpression(node.arguments[0]) || t.isFunctionExpression(node.arguments[0]));
  }

  // Given a child expression, try to resolve a content key.
  // Returns either `"site.brand"` (static path) or `"products[].name"` (template)
  // or null when it can't be statically attributed.
  function resolveContentKey(node: Expression, s: PluginState): string | null {
    const chain = readChain(node);
    if (!chain) return null;
    const root = chain[0];
    if (s.contentBindings.has(root)) {
      return chain.join('.');
    }
    for (let i = s.mapStack.length - 1; i >= 0; i--) {
      if (s.mapStack[i].paramName === root) {
        const rest = chain.slice(1);
        return rest.length === 0
          ? `${s.mapStack[i].pathBase}[]`
          : `${s.mapStack[i].pathBase}[].${rest.join('.')}`;
      }
    }
    return null;
  }

  function pickSoleExpressionContainer(jsxElement: JSXElement): types.JSXExpressionContainer | null {
    const meaningful = jsxElement.children.filter(isMeaningfulChild);
    if (meaningful.length !== 1) return null;
    const child = meaningful[0];
    if (!t.isJSXExpressionContainer(child)) return null;
    if (t.isJSXEmptyExpression(child.expression)) return null;
    if (t.isJSXElement(child.expression) || t.isJSXFragment(child.expression)) return null;
    return child;
  }

  function isFormattedBoundTextElement(jsxElement: JSXElement): boolean {
    return t.isJSXIdentifier(jsxElement.openingElement.name) &&
      jsxElement.openingElement.name.name === 'FormattedBoundText';
  }

  function hasFormattedBoundTextChild(jsxElement: JSXElement): boolean {
    return jsxElement.children.some((child) => t.isJSXElement(child) && isFormattedBoundTextElement(child));
  }

  function isStaticLiteralExpression(expression: Expression): boolean {
    return t.isStringLiteral(expression) ||
      t.isNumericLiteral(expression) ||
      t.isBooleanLiteral(expression) ||
      t.isNullLiteral(expression) ||
      (t.isTemplateLiteral(expression) && expression.expressions.length === 0);
  }

  function hasDynamicChildExpression(jsxElement: JSXElement): boolean {
    return jsxElement.children.some(child =>
      t.isJSXExpressionContainer(child) &&
      !t.isJSXEmptyExpression(child.expression) &&
      !t.isStringLiteral(child.expression) &&
      !(t.isTemplateLiteral(child.expression) && child.expression.expressions.length === 0)
    );
  }

  return {
    name: 'jsx-source-mapper',
    visitor: {
      Program: {
        enter(_path: NodePath<Program>, state: PluginState) {
          state.contentBindings = new Set();
          state.mapStack = [];
          state.mapFrames = new WeakMap();
          state.genericMapDepth = 0;
          state.genericMapFrames = new WeakSet();
          state.ancestorStack = [];
          state.programPath = _path;
          state.formatBoundTextRuntimeAvailable = isFormatBoundTextRuntimeAvailable(
            state.filename || state.file.opts.filename || undefined,
            {
              enabled: state.opts?.formatBoundTextRuntime,
              rootDir: state.opts?.formatBoundTextRoot,
            },
          );
        },
      },

      ImportDeclaration(path: NodePath<ImportDeclaration>, state: PluginState) {
        if (path.node.source.value !== CONTENT_MODULE) return;
        for (const spec of path.node.specifiers) {
          if (t.isImportSpecifier(spec) && t.isIdentifier(spec.local)) {
            state.contentBindings.add(spec.local.name);
          } else if (t.isImportNamespaceSpecifier(spec) && t.isIdentifier(spec.local)) {
            state.contentBindings.add(spec.local.name);
          }
        }
      },

      CallExpression: {
        enter(path: NodePath<CallExpression>, state: PluginState) {
          if (isAnyMapCall(path.node)) {
            state.genericMapFrames.add(path.node);
            state.genericMapDepth += 1;
          }

          const frame = analyzeMapCall(path.node, state);
          if (frame) {
            state.mapFrames.set(path.node, frame);
            state.mapStack.push(frame);
          }
        },
        exit(path: NodePath<CallExpression>, state: PluginState) {
          if (state.genericMapFrames.has(path.node)) {
            state.genericMapDepth -= 1;
          }

          if (state.mapFrames.has(path.node)) {
            state.mapStack.pop();
          }
        },
      },

      JSXElement: {
        enter(path: NodePath<JSXElement>, state: PluginState) {
          const isDevBuild = process.env.NODE_ENV !== 'production';
          const openingElement = path.node.openingElement;
          const rawTagName = getJsxTagName(openingElement);
          const textTagName = getIntrinsicTextTagName(openingElement, t);

          // Track this element in the ancestor stack for structural ID computation
          const parentFrame = state.ancestorStack[state.ancestorStack.length - 1];
          let siblingIndex = 0;
          if (parentFrame) {
            siblingIndex = parentFrame.sameTagChildCount.get(rawTagName) || 0;
            parentFrame.sameTagChildCount.set(rawTagName, siblingIndex + 1);
          }

          // Push frame for this element's children
          state.ancestorStack.push({ tagName: rawTagName, ownIndex: siblingIndex, sameTagChildCount: new Map() });

          // Get source information
          const fileName = state.filename || state.file.opts.filename || 'unknown';
          const normalizedFileName = normalizeFileName(fileName);

          // Default excluded paths (component libraries)
          const defaultExcludePaths = [
            'components/ui/',
            '/components/ui/',
            'src/components/ui/',
            '/src/components/ui/',
            'src/components/FormattedBoundText.tsx',
            '/src/components/FormattedBoundText.tsx',
          ];

          const excludePaths = state.opts?.excludePaths || defaultExcludePaths;
          const fileNameForExclusion = fileName.replace(/\\/g, '/');

          // Skip if file is in excluded paths (component libraries)
          if (excludePaths.some(excludePath => fileNameForExclusion.includes(excludePath))) {
            return;
          }

          if (isFormattedBoundTextElement(path.node)) {
            return;
          }

          // Pre-pass: when the element has mixed children AND one or more of
          // them is a content-rooted expression (e.g., `<span>{home.a} · {home.b}</span>`),
          // wrap each content expression in a single-child <span data-dev-content-key="...">.
          if (isDevBuild && isNativeTagParent(openingElement)) {
            const meaningfulCount = path.node.children.filter(isMeaningfulChild).length;
            if (meaningfulCount >= 2) {
              for (let i = 0; i < path.node.children.length; i++) {
                const child = path.node.children[i];
                if (!child || !t.isJSXExpressionContainer(child)) continue;
                if (t.isJSXEmptyExpression(child.expression)) continue;
                const childKey = resolveContentKey(child.expression as Expression, state);
                if (!childKey) continue;
                const wrapAttr = childKey.includes('[]')
                  ? 'data-dev-content-key-template'
                  : 'data-dev-content-key';
                const opening = t.jsxOpeningElement(
                  t.jsxIdentifier('span'),
                  [t.jsxAttribute(t.jsxIdentifier(wrapAttr), t.stringLiteral(childKey))],
                  false,
                );
                opening.loc = child.loc;
                const wrapper = t.jsxElement(
                  opening,
                  t.jsxClosingElement(t.jsxIdentifier('span')),
                  [child],
                  false,
                );
                wrapper.loc = child.loc;
                path.node.children[i] = wrapper;
              }
            }
          }

          // Content key attribution
          const expressionContainer = pickSoleExpressionContainer(path.node);
          const expression = expressionContainer?.expression as Expression | undefined;
          const contentKey = expression ? resolveContentKey(expression, state) : null;
          const hasDynamic = hasDynamicChildExpression(path.node);
          const lineNumber = openingElement.loc ? openingElement.loc.start.line : 0;

          // Compute structural ID from ancestor chain
          const ancestorChain = state.ancestorStack.slice(0, -1).map(f => `${f.tagName}#${f.ownIndex}`).join('>');
          const structuralKey = `${normalizedFileName}:${ancestorChain}${ancestorChain ? '>' : ''}${rawTagName}#${siblingIndex}`;
          const devId = hashStructuralKey(structuralKey);
          const sourceKind = contentKey
            ? contentKey.includes('[]') ? 'content-key-template' : 'content-key'
            : 'bound-expression';
          const candidate: BoundTextCandidate | null =
            textTagName &&
            expression &&
            !isStaticLiteralExpression(expression) &&
            state.formatBoundTextRuntimeAvailable &&
            state.genericMapDepth === 0
              ? {
                  devId,
                  file: normalizedFileName,
                  tagName: textTagName,
                  sourceKind,
                  contentKey: sourceKind === 'content-key' ? contentKey : null,
                  contentKeyTemplate: sourceKind === 'content-key-template' ? contentKey : null,
                  expressionHash: sourceKind === 'bound-expression' ? hashExpression(expression) : null,
                }
              : null;

          if (candidate && expressionContainer && !hasFormattedBoundTextChild(path.node)) {
            const wrapper = t.jsxElement(
              t.jsxOpeningElement(t.jsxIdentifier('FormattedBoundText'), [
                t.jsxAttribute(t.jsxIdentifier('devId'), t.stringLiteral(candidate.devId)),
                t.jsxAttribute(t.jsxIdentifier('guard'), buildGuardExpression(candidate, t)),
              ], false),
              t.jsxClosingElement(t.jsxIdentifier('FormattedBoundText')),
              [t.jsxExpressionContainer(expression as Expression)],
              false,
            );
            path.node.children = path.node.children.map((child) => child === expressionContainer ? wrapper : child);
            if (state.programPath) ensureFormattedBoundTextImport(state.programPath, t);
          }

          if (!isDevBuild) return;

          if (contentKey) {
            const attrName = contentKey.includes('[]')
              ? 'data-dev-content-key-template'
              : 'data-dev-content-key';
            if (!hasAttr(openingElement.attributes, attrName)) {
              openingElement.attributes.push(
                t.jsxAttribute(t.jsxIdentifier(attrName), t.stringLiteral(contentKey)),
              );
            }
          } else {
            if (hasDynamic && !hasAttr(openingElement.attributes, 'data-dev-dynamic')) {
              openingElement.attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('data-dev-dynamic'),
                  t.stringLiteral('true')
                )
              );
            }
          }

          if (candidate) {
            openingElement.attributes.push(
              t.jsxAttribute(t.jsxIdentifier('data-dev-bound-text'), t.stringLiteral('true')),
              t.jsxAttribute(t.jsxIdentifier('data-dev-bound-source-kind'), t.stringLiteral(candidate.sourceKind)),
            );
            if (candidate.expressionHash) {
              openingElement.attributes.push(
                t.jsxAttribute(t.jsxIdentifier('data-dev-bound-expression-hash'), t.stringLiteral(candidate.expressionHash)),
              );
            }
          }

          // Skip if already attributed
          if (hasAttr(openingElement.attributes, 'data-dev-file')) {
            return;
          }

          // Add source attributes
          openingElement.attributes.push(
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-file'),
              t.stringLiteral(fileName)
            ),
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-line'),
              t.jsxExpressionContainer(t.numericLiteral(lineNumber))
            ),
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-id'),
              t.stringLiteral(devId)
            )
          );
        },

        exit(_path: NodePath<JSXElement>, state: PluginState) {
          state.ancestorStack.pop();
        },
      },
    }
  };
}
