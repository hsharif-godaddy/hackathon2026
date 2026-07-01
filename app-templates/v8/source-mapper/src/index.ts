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
  commerceComponentLocals: Set<string>;
  commerceComponentNamespaces: Set<string>;
  hasCommerceDataUsage: boolean;
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
const COMMERCE_MODULE = '@godaddy/react';
const COMMERCE_COMPONENTS = new Set(['ProductGrid', 'ProductDetails', 'ProductCard', 'Cart']);
const COMMERCE_DATA_ROOTS = new Set(['skuGroup', 'sku', 'product', 'node']);

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

  function isCommerceComponentTagName(tagName: string, state: PluginState): boolean {
    if (state.commerceComponentLocals.has(tagName)) return true;
    const [namespace, component] = tagName.split('.');
    return !!namespace &&
      !!component &&
      state.commerceComponentNamespaces.has(namespace) &&
      COMMERCE_COMPONENTS.has(component);
  }

  function getJsxAttribute(
    attrs: JSXElement['openingElement']['attributes'],
    name: string,
  ): types.JSXAttribute | null {
    return attrs.find(
      (attr): attr is types.JSXAttribute =>
        t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === name,
    ) ?? null;
  }

  function buildCommerceWrapper(path: NodePath<JSXElement>, componentName: string): types.JSXElement {
    const child = t.cloneNode(path.node, true);
    const attrs = [
      t.jsxAttribute(t.jsxIdentifier('data-dev-source-origin'), t.stringLiteral('commerce')),
      t.jsxAttribute(t.jsxIdentifier('data-dev-commerce-component'), t.stringLiteral(componentName)),
      t.jsxAttribute(
        t.jsxIdentifier('style'),
        t.jsxExpressionContainer(
          t.objectExpression([
            t.objectProperty(t.identifier('display'), t.stringLiteral('contents')),
          ]),
        ),
      ),
    ];
    const productId = getJsxAttribute(child.openingElement.attributes, 'productId');
    if (productId?.value) {
      attrs.splice(2, 0, t.jsxAttribute(t.jsxIdentifier('data-dev-commerce-product-id'), productId.value));
    }
    return t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier('div'), attrs, false),
      t.jsxClosingElement(t.jsxIdentifier('div')),
      [child],
      false,
    );
  }

  function isCommerceHelperModule(source: string): boolean {
    return source.includes('/lib/commerce/');
  }

  function expressionReferencesCommerceData(node: types.Node | null | undefined): boolean {
    if (!node || t.isJSXEmptyExpression(node)) return false;
    if (t.isIdentifier(node)) return COMMERCE_DATA_ROOTS.has(node.name);
    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      return expressionReferencesCommerceData(node.object) ||
        (node.computed && expressionReferencesCommerceData(node.property));
    }
    if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
      return expressionReferencesCommerceData(node.callee) ||
        node.arguments.some((arg) => !t.isSpreadElement(arg) && expressionReferencesCommerceData(arg));
    }
    if (t.isLogicalExpression(node) || t.isBinaryExpression(node)) {
      return expressionReferencesCommerceData(node.left) || expressionReferencesCommerceData(node.right);
    }
    if (t.isConditionalExpression(node)) {
      return expressionReferencesCommerceData(node.test) ||
        expressionReferencesCommerceData(node.consequent) ||
        expressionReferencesCommerceData(node.alternate);
    }
    if (t.isTemplateLiteral(node)) {
      return node.expressions.some((expr) => expressionReferencesCommerceData(expr));
    }
    return false;
  }

  function jsxElementOwnReferencesCommerceData(jsxElement: JSXElement): boolean {
    return jsxElement.openingElement.attributes.some((attr) =>
      t.isJSXAttribute(attr) &&
      t.isJSXExpressionContainer(attr.value) &&
      expressionReferencesCommerceData(attr.value.expression),
    ) ||
      jsxElement.children.some((child) =>
        t.isJSXExpressionContainer(child) &&
        expressionReferencesCommerceData(child.expression),
      );
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
  // iff every hop is an identifier-typed, non-computed property access OR a
  // computed access whose property is a non-negative integer NumericLiteral
  // (captured as a numeric index segment, e.g. `stats[0]` → `["stats", 0]`).
  // Returns null for any other unsupported shape (string-literal/identifier/
  // expression computed indices, destructuring, etc.).
  function readChain(node: Expression): (string | number)[] | null {
    const parts: (string | number)[] = [];
    let cur: Expression = node;
    while (t.isMemberExpression(cur)) {
      if (cur.computed) {
        if (
          t.isNumericLiteral(cur.property) &&
          Number.isInteger(cur.property.value) &&
          cur.property.value >= 0
        ) {
          parts.unshift(cur.property.value);
          cur = cur.object as Expression;
          continue;
        }
        return null;
      }
      if (!t.isIdentifier(cur.property)) return null;
      parts.unshift(cur.property.name);
      cur = cur.object as Expression;
    }
    if (!t.isIdentifier(cur)) return null;
    parts.unshift(cur.name);
    return parts;
  }

  // Render a chain of name/index segments to canonical content-key form:
  // numeric segments become `[N]` with no leading dot, string segments are
  // dot-joined. e.g. `["home", "about", "stats", 0, "value"]` →
  // `home.about.stats[0].value`. The first segment is always a string (root).
  function renderChain(parts: (string | number)[]): string {
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof part === 'number') {
        out += `[${part}]`;
      } else {
        out += i === 0 ? part : `.${part}`;
      }
    }
    return out;
  }

  // If `node` is a `.map()` call on a content-rooted chain, return the frame
  // metadata; otherwise null.
  function analyzeMapCall(node: CallExpression, s: PluginState): IterationFrame | null {
    if (!t.isMemberExpression(node.callee)) return null;
    if (node.callee.computed) return null;
    if (!t.isIdentifier(node.callee.property, { name: 'map' })) return null;
    // Resolve the iterated chain to a content path. This handles both a direct
    // content root (`menu.categories` → `menu.categories`) and a NESTED map over
    // an outer loop param (`cat.items` → `menu.categories[].items`), so nested
    // collections (categories → items → price) are attributable, not just one
    // level deep. The parent map's frame is already on the stack at this point.
    const pathBase = resolveContentKey(node.callee.object as Expression, s);
    if (!pathBase) return null;
    const cb = node.arguments[0];
    if (!cb || (!t.isArrowFunctionExpression(cb) && !t.isFunctionExpression(cb))) return null;
    const first = cb.params[0];
    if (!t.isIdentifier(first)) return null;
    return { paramName: first.name, pathBase };
  }

  function isAnyMapCall(node: CallExpression): boolean {
    return t.isMemberExpression(node.callee) &&
      !node.callee.computed &&
      t.isIdentifier(node.callee.property, { name: 'map' }) &&
      node.arguments.length > 0 &&
      (t.isArrowFunctionExpression(node.arguments[0]) || t.isFunctionExpression(node.arguments[0]));
  }

  // Unwrap a conditional/logical expression down to a JSXElement, if possible.
  // LogicalExpression (&&) → right; ConditionalExpression (? :) → both branches.
  // Returns all reachable JSXElement leaves (may be empty if none found).
  function unwrapToJsxElements(node: types.Expression): types.JSXElement[] {
    if (t.isJSXElement(node)) return [node];
    if (t.isLogicalExpression(node)) return unwrapToJsxElements(node.right);
    if (t.isConditionalExpression(node)) {
      return [
        ...unwrapToJsxElements(node.consequent),
        ...unwrapToJsxElements(node.alternate),
      ];
    }
    return [];
  }

  // Collect the per-item root JSXElement(s) that a map callback returns.
  // Handles: arrow with expression body (JSXElement), and arrow/function
  // with block body (top-level return statements, without descending into
  // nested functions). Fragments and non-element returns are skipped.
  function collectCallbackRootElements(
    cb: types.ArrowFunctionExpression | types.FunctionExpression,
  ): types.JSXElement[] {
    const body = cb.body;

    if (!t.isBlockStatement(body)) {
      // Arrow expression body: unwrap conditional/logical to JSXElement(s)
      return unwrapToJsxElements(body as types.Expression);
    }

    // Block body: collect JSX from top-level return statements only;
    // do not descend into nested arrow/function nodes.
    const roots: types.JSXElement[] = [];
    function visitStmts(stmts: types.Statement[]): void {
      for (const stmt of stmts) {
        if (t.isReturnStatement(stmt) && stmt.argument) {
          roots.push(...unwrapToJsxElements(stmt.argument));
        } else if (t.isIfStatement(stmt)) {
          visitStmts([stmt.consequent]);
          if (stmt.alternate) visitStmts([stmt.alternate]);
        } else if (t.isBlockStatement(stmt)) {
          visitStmts(stmt.body);
        }
        // Do NOT recurse into nested ArrowFunctionExpression / FunctionExpression
      }
    }
    visitStmts(body.body);
    return roots;
  }

  // Inject per-item list instrumentation onto each per-item root JSXElement.
  // This is the gap 2b contract: each element returned by a content-bound .map()
  // callback carries data-dev-content-list (frame.pathBase — the template-form path
  // of the iterated array) and data-dev-content-list-index (the map callback's index
  // param). This allows the 2a resolver to substitute concrete indices into the
  // leaf data-dev-content-key-template, resolving e.g.
  //   "menu.categories[].items[].price" → "menu.categories[0].items[0].price".
  function injectListAttrs(
    mapPath: NodePath<CallExpression>,
    frame: IterationFrame,
  ): void {
    if (process.env.NODE_ENV === 'production') return;

    const cb = mapPath.node.arguments[0];
    if (!t.isArrowFunctionExpression(cb) && !t.isFunctionExpression(cb)) return;

    // Find the per-item root element(s) first: a fragment/non-element return has
    // nothing to tag, so we must not synthesize an (orphaned) index param for it.
    const roots = collectCallbackRootElements(cb);
    if (roots.length === 0) return;

    // Determine index param name: reuse existing 2nd param if it's an identifier;
    // skip if 2nd param is a destructuring pattern (can't reference it by name);
    // otherwise generate a unique name and inject it as a new 2nd param.
    let idxParamName: string;
    const secondParam = cb.params[1];
    if (secondParam !== undefined) {
      if (!t.isIdentifier(secondParam)) {
        // Destructuring pattern — can't reference it; skip injection for this map
        return;
      }
      idxParamName = secondParam.name;
    } else {
      // No 2nd param: generate a unique name scoped to this callback to avoid
      // shadowing across nested maps (each map gets a distinct _airoIdx_N name).
      // generateUid reserves the name in the scope's uid registry, so successive
      // calls stay distinct even though we push the param directly without a
      // scope.crawl() to register the binding — uid uniqueness, not binding
      // lookup, is what guarantees no collision here.
      const cbPath = mapPath.get('arguments.0') as NodePath;
      idxParamName = cbPath.scope.generateUid('airoIdx');
      cb.params.push(t.identifier(idxParamName));
    }

    const firstParam = cb.params[0];
    const itemParamName =
      firstParam !== undefined && t.isIdentifier(firstParam) ? firstParam.name : null;

    for (const root of roots) {
      const attrs = root.openingElement.attributes;
      // Guard: skip if already carries data-dev-content-list (e.g. manual ContentListContext)
      if (hasAttr(attrs, 'data-dev-content-list')) continue;
      attrs.push(
        t.jsxAttribute(t.jsxIdentifier('data-dev-content-list'), t.stringLiteral(frame.pathBase)),
        t.jsxAttribute(
          t.jsxIdentifier('data-dev-content-list-index'),
          t.jsxExpressionContainer(t.identifier(idxParamName)),
        ),
      );
      // Defensive: analyzeMapCall already gated on `t.isIdentifier(first)`, so
      // itemParamName should always be non-null here. But injectListAttrs is safe
      // if that invariant ever loosens (e.g., a new call site, a relaxed gate).
      if (itemParamName !== null && !hasAttr(attrs, 'data-dev-item-id')) {
        attrs.push(
          t.jsxAttribute(
            t.jsxIdentifier('data-dev-item-id'),
            t.jsxExpressionContainer(
              t.memberExpression(t.identifier(itemParamName), t.identifier('id')),
            ),
          ),
        );
      }
    }
  }

  // Given a child expression, try to resolve a content key.
  // Returns either `"site.brand"` (static path) or `"products[].name"` (template)
  // or null when it can't be statically attributed.
  function resolveContentKey(node: Expression, s: PluginState): string | null {
    const chain = readChain(node);
    if (!chain) return null;
    const root = chain[0];
    // The root segment is the identifier name; a numeric root is impossible
    // (readChain always unshifts an Identifier name first), but narrow for type.
    if (typeof root !== 'string') return null;
    if (s.contentBindings.has(root)) {
      return renderChain(chain);
    }
    for (let i = s.mapStack.length - 1; i >= 0; i--) {
      if (s.mapStack[i].paramName === root) {
        const rest = chain.slice(1);
        return rest.length === 0
          ? `${s.mapStack[i].pathBase}[]`
          : `${s.mapStack[i].pathBase}[].${renderChain(rest)}`;
      }
    }
    return null;
  }

  // Resolve a content key reached indirectly through a call, e.g.
  // `const { display } = useCounter(home.about.stats[0].value)` rendered as
  // `<span>{display}</span>`. Conservative: only a bare Identifier bound to a
  // VariableDeclarator whose init is a CallExpression where exactly ONE argument
  // resolves to a NON-template content key (no `[]`); other args (durations,
  // options, flags) are ignored, and ≥2 content args is ambiguous → skip.
  // Indexed keys (`home.about.stats[0].value`) are allowed. Returns the key or null.
  //
  // This matches by call SHAPE, so it also attributes e.g. `const [v] =
  // useState(home.x)` — intentionally. Whether the value is a genuine
  // pass-through or a transform is decided at edit time by the server guard
  // (it writes only when the stored content still equals the rendered text),
  // NOT here. So a false match is safe: a transforming hook simply gets its
  // edit refused rather than corrupting content.
  function resolveDerivedContentKey(
    expression: Expression,
    path: NodePath<JSXElement>,
    s: PluginState,
  ): string | null {
    if (!t.isIdentifier(expression)) return null;
    const binding = path.scope.getBinding(expression.name);
    if (!binding) return null;
    const declarator: NodePath | null = binding.path.isVariableDeclarator()
      ? binding.path
      : binding.path.findParent((p: NodePath): boolean => p.isVariableDeclarator());
    if (!declarator || !declarator.isVariableDeclarator()) return null;
    const init = declarator.node.init;
    if (!init || !t.isCallExpression(init)) return null;
    // Exactly ONE argument must resolve to a (non-template) content key; other
    // args (durations, options, flags — e.g. `useCountUp(home.x, 2000, started)`)
    // are ignored. Zero content args = nothing to attribute; two or more =
    // ambiguous which one the rendered value derives from, so skip.
    const contentKeys: string[] = init.arguments
      .filter(
        (a): a is Expression =>
          !t.isSpreadElement(a) && !t.isJSXNamespacedName(a) && !t.isArgumentPlaceholder(a),
      )
      .map((a: Expression): string | null => resolveContentKey(a, s))
      .filter((k: string | null): k is string => k !== null && !k.includes('[]'));
    if (contentKeys.length !== 1) return null;
    return contentKeys[0]!;
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

  // `{children}` / `{props.children}` / `{this.props.children}` render child nodes,
  // not editable text — so they must not taint the element as dynamic.
  function isStructuralPassthroughExpression(expression: Expression): boolean {
    if (t.isIdentifier(expression)) {
      return expression.name === 'children';
    }
    if (t.isMemberExpression(expression) || t.isOptionalMemberExpression(expression)) {
      return !expression.computed && t.isIdentifier(expression.property) && expression.property.name === 'children';
    }
    return false;
  }

  function hasDynamicChildExpression(jsxElement: JSXElement): boolean {
    return jsxElement.children.some(child =>
      t.isJSXExpressionContainer(child) &&
      !t.isJSXEmptyExpression(child.expression) &&
      !t.isStringLiteral(child.expression) &&
      !(t.isTemplateLiteral(child.expression) && child.expression.expressions.length === 0) &&
      !isStructuralPassthroughExpression(child.expression)
    );
  }

  // Inline-formatting tags that may appear as direct children of an editable
  // text element without disqualifying it. Mirrors the client's hasOnlyText
  // allowlist in dev-tools/element-detection.ts.
  const INLINE_FORMAT_TAGS = new Set(['span', 'strong', 'em', 'b', 'i', 'a', 'br']);

  // Resolve the intrinsic tag of an inline-formatting child element, or null if
  // it isn't statically knowable. `<span>` → "span"; a native-tag wrapper like
  // `<motion.span>`/`<motion.strong>` (lowercase member-expression root) → its
  // leaf property ("span"); a real component (`<Highlight>`, `<Foo.Bar>`) → null,
  // because we can't know what it renders.
  function inlineChildTagName(opening: JSXElement['openingElement']): string | null {
    const name = opening.name;
    if (t.isJSXIdentifier(name)) return name.name;
    if (t.isJSXMemberExpression(name)) {
      let root: types.JSXMemberExpression['object'] = name;
      while (t.isJSXMemberExpression(root)) root = root.object;
      const isNativeWrapper: boolean = t.isJSXIdentifier(root) && /^[a-z]/.test(root.name);
      return isNativeWrapper ? name.property.name : null;
    }
    return null;
  }

  // Authoritative editability predicate for the additive data-dev-editable="text"
  // marker. Direct-children-only. A CONSERVATIVE SUBSET of server-acceptance
  // (hasUnsupportedDynamicTextExpression, ast-text-editor.ts): it never marks a
  // node the server would reject, but it may withhold the marker on a node the
  // server WOULD accept — the server ignores element children entirely, whereas
  // this also requires every element child to resolve to an intrinsic inline tag
  // (so an unresolvable component child — unknown render — shuts editing off
  // rather than risk an accept-then-reject). A non-static JSXExpressionContainer
  // child (identifier/member/call/conditional/template-with-substitutions)
  // disqualifies; JSXText, static expression containers (string literal / empty
  // template / comment), and intrinsic inline-format child elements (incl.
  // `motion.*` wrappers, resolved to their leaf tag) are all editable.
  function isStaticallyTextEditable(jsxElement: JSXElement): boolean {
    return jsxElement.children.every((child) => {
      if (t.isJSXText(child)) return true;
      if (t.isJSXExpressionContainer(child)) {
        return t.isJSXEmptyExpression(child.expression) ||
          t.isStringLiteral(child.expression) ||
          (t.isTemplateLiteral(child.expression) && child.expression.expressions.length === 0);
      }
      if (t.isJSXElement(child)) {
        const tag: string | null = inlineChildTagName(child.openingElement);
        return tag !== null && INLINE_FORMAT_TAGS.has(tag);
      }
      // JSXFragment / JSXSpreadChild — not statically editable.
      return false;
    });
  }

  return {
    name: 'jsx-source-mapper',
    visitor: {
      Program: {
        enter(_path: NodePath<Program>, state: PluginState) {
          state.contentBindings = new Set();
          state.commerceComponentLocals = new Set();
          state.commerceComponentNamespaces = new Set();
          state.hasCommerceDataUsage = false;
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
        if (path.node.source.value === CONTENT_MODULE) {
          for (const spec of path.node.specifiers) {
            if (t.isImportSpecifier(spec) && t.isIdentifier(spec.local)) {
              state.contentBindings.add(spec.local.name);
            } else if (t.isImportNamespaceSpecifier(spec) && t.isIdentifier(spec.local)) {
              state.contentBindings.add(spec.local.name);
            }
          }
          return;
        }

        if (typeof path.node.source.value === 'string' && isCommerceHelperModule(path.node.source.value)) {
          state.hasCommerceDataUsage = true;
        }

        if (path.node.source.value === COMMERCE_MODULE) {
          for (const spec of path.node.specifiers) {
            if (
              t.isImportSpecifier(spec) &&
              t.isIdentifier(spec.imported) &&
              COMMERCE_COMPONENTS.has(spec.imported.name) &&
              t.isIdentifier(spec.local)
            ) {
              state.commerceComponentLocals.add(spec.local.name);
            } else if (t.isImportNamespaceSpecifier(spec) && t.isIdentifier(spec.local)) {
              state.commerceComponentNamespaces.add(spec.local.name);
            }
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
            // Inject per-item list instrumentation onto the callback's root JSX element(s).
            // Must happen in enter (before child JSX visitors run) so the attrs are present
            // when the JSX visitor checks for existing content-list attributes.
            injectListAttrs(path, frame);
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

          if (
            isDevBuild &&
            isCommerceComponentTagName(rawTagName, state) &&
            !hasAttr(openingElement.attributes, 'data-dev-source-origin')
          ) {
            path.replaceWith(buildCommerceWrapper(path, rawTagName));
            path.skip();
            return;
          }

          if (
            isDevBuild &&
            state.hasCommerceDataUsage &&
            isNativeTagParent(openingElement) &&
            !hasAttr(openingElement.attributes, 'data-dev-source-origin') &&
            jsxElementOwnReferencesCommerceData(path.node)
          ) {
            openingElement.attributes.push(
              t.jsxAttribute(t.jsxIdentifier('data-dev-source-origin'), t.stringLiteral('commerce')),
            );
          }

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
          const derivedContentKey =
            isDevBuild && !contentKey && expression
              ? resolveDerivedContentKey(expression, path, state)
              : null;
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
            !derivedContentKey &&
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
          } else if (derivedContentKey) {
            if (!hasAttr(openingElement.attributes, 'data-dev-content-key')) {
              openingElement.attributes.push(
                t.jsxAttribute(t.jsxIdentifier('data-dev-content-key'), t.stringLiteral(derivedContentKey)),
                t.jsxAttribute(t.jsxIdentifier('data-dev-content-derived'), t.stringLiteral('true')),
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
            } else if (
              textTagName &&
              !hasDynamic &&
              isStaticallyTextEditable(path.node) &&
              !hasAttr(openingElement.attributes, 'data-dev-editable')
            ) {
              // Authoritative per-node signal: this intrinsic text element is
              // statically editable by the same rule the server uses to accept a
              // save. Purely additive — never emitted for content-keyed or
              // dynamic nodes. The client trusts this only to shut OFF editing.
              openingElement.attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('data-dev-editable'),
                  t.stringLiteral('text')
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
