import type { PluginObj, PluginPass, types, NodePath } from '@babel/core';
import type { JSXElement, Program, ImportDeclaration, CallExpression, Expression } from '@babel/types';

interface PluginOptions {
  excludePaths?: string[];
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
  ancestorStack: AncestorFrame[];
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

  // Pick the sole meaningful expression child (using the same filter as the
  // mixed-child gate so JSX comments don't cause inconsistent counting).
  function pickSoleExpressionChild(jsxElement: JSXElement): Expression | null {
    const meaningful = jsxElement.children.filter(isMeaningfulChild);
    if (meaningful.length !== 1) return null;
    const child = meaningful[0];
    if (!t.isJSXExpressionContainer(child)) return null;
    if (t.isJSXEmptyExpression(child.expression)) return null;
    return child.expression as Expression;
  }

  return {
    name: 'jsx-source-mapper',
    visitor: {
      Program: {
        enter(_path: NodePath<Program>, state: PluginState) {
          state.contentBindings = new Set();
          state.mapStack = [];
          state.mapFrames = new WeakMap();
          state.ancestorStack = [];
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
          const frame = analyzeMapCall(path.node, state);
          if (frame) {
            state.mapFrames.set(path.node, frame);
            state.mapStack.push(frame);
          }
        },
        exit(path: NodePath<CallExpression>, state: PluginState) {
          if (state.mapFrames.has(path.node)) {
            state.mapStack.pop();
          }
        },
      },

      JSXElement: {
        enter(path: NodePath<JSXElement>, state: PluginState) {
          // Skip in production
          if (process.env.NODE_ENV === 'production') {
            return;
          }

          const openingElement = path.node.openingElement;
          const tagName = getJsxTagName(openingElement);

          // Track this element in the ancestor stack for structural ID computation
          const parentFrame = state.ancestorStack[state.ancestorStack.length - 1];
          let siblingIndex = 0;
          if (parentFrame) {
            siblingIndex = parentFrame.sameTagChildCount.get(tagName) || 0;
            parentFrame.sameTagChildCount.set(tagName, siblingIndex + 1);
          }

          // Push frame for this element's children
          state.ancestorStack.push({ tagName, ownIndex: siblingIndex, sameTagChildCount: new Map() });

          // Get source information
          const fileName = state.filename || state.file.opts.filename || 'unknown';

          // Default excluded paths (component libraries)
          const defaultExcludePaths = [
            'components/ui/',
            '/components/ui/',
            'src/components/ui/',
            '/src/components/ui/'
          ];

          const excludePaths = state.opts?.excludePaths || defaultExcludePaths;

          // Skip if file is in excluded paths (component libraries)
          if (excludePaths.some(excludePath => fileName.includes(excludePath))) {
            return;
          }

          // Pre-pass: when the element has mixed children AND one or more of
          // them is a content-rooted expression (e.g., `<span>{home.a} · {home.b}</span>`),
          // wrap each content expression in a single-child <span data-dev-content-key="...">.
          if (isNativeTagParent(openingElement)) {
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
          const expression = pickSoleExpressionChild(path.node);
          const contentKey = expression ? resolveContentKey(expression, state) : null;

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
            const hasDynamic = path.node.children.some(child =>
              t.isJSXExpressionContainer(child) &&
              !t.isJSXEmptyExpression(child.expression) &&
              !t.isStringLiteral(child.expression) &&
              !(t.isTemplateLiteral(child.expression) && child.expression.expressions.length === 0)
            );

            if (hasDynamic && !hasAttr(openingElement.attributes, 'data-dev-dynamic')) {
              openingElement.attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('data-dev-dynamic'),
                  t.stringLiteral('true')
                )
              );
            }
          }

          // Skip if already attributed
          if (hasAttr(openingElement.attributes, 'data-dev-file')) {
            return;
          }

          const lineNumber = openingElement.loc ? openingElement.loc.start.line : 0;

          // Compute structural ID from ancestor chain
          const ancestorChain = state.ancestorStack.slice(0, -1).map(f => `${f.tagName}#${f.ownIndex}`).join('>');
          const structuralKey = `${normalizeFileName(fileName)}:${ancestorChain}${ancestorChain ? '>' : ''}${tagName}#${siblingIndex}`;
          const devId = hashStructuralKey(structuralKey);

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
          if (process.env.NODE_ENV === 'production') return;
          state.ancestorStack.pop();
        },
      },
    }
  };
}
