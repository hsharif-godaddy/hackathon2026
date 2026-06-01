const UNSAFE_URL_RE = /^\s*javascript:/i;

export function htmlToJsx(html: string, preserveSpans = false): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const nodes = Array.from(doc.body.childNodes).flatMap((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toLowerCase() === 'p') {
      return Array.from(node.childNodes);
    }
    return [node];
  });
  return nodes.map(n => nodeToJsx(n, preserveSpans)).join('');
}

export interface StructuredJsx {
  childrenJsx: string;
  rootTag: string | null;
  rootAttributes: string | null;
}

export function htmlToJsxStructured(html: string, preserveSpans = false): StructuredJsx {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) {
    return { childrenJsx: htmlToJsx(html, preserveSpans), rootTag: null, rootAttributes: null };
  }

  const tag = root.tagName.toLowerCase();
  const childrenJsx = Array.from(root.childNodes).map(n => nodeToJsx(n, preserveSpans)).join('');
  const attrParts = attributesToJsx(root);
  const rootAttributes = attrParts.length > 0 ? attrParts.join(' ') : null;

  if (tag === 'p') {
    return { childrenJsx, rootTag: null, rootAttributes };
  }
  return { childrenJsx, rootTag: tag, rootAttributes };
}

function camelCase(prop: string): string {
  if (prop.startsWith('--')) return prop;
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// whiteSpace from Lexical, cursor from ElementHoverBar — both leak via outerHTML.
const DEV_TOOLS_STYLE_PROPS = new Set(['whiteSpace', 'cursor']);

function styleToJsx(css: string): string | null {
  const entries = css
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .flatMap((decl) => {
      const i = decl.indexOf(':');
      if (i === -1) return [];
      const prop = camelCase(decl.slice(0, i).trim());
      const value = decl.slice(i + 1).trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return [[prop, value] as const];
    })
    .filter(([prop]) => !DEV_TOOLS_STYLE_PROPS.has(prop));

  if (entries.length === 0) return null;
  return '{{' + entries.map(([p, v]) => `${p}: '${v}'`).join(', ') + '}}';
}

function escapeAttrValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

const EDITOR_ARTIFACT_ATTRS = new Set(['dir', 'spellcheck', 'autocorrect', 'autocapitalize']);

function attributesToJsx(el: Element): string[] {
  const parts: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    // Strip source-mapper injections (data-dev-*) — re-injected on every build, would compound across edits.
    if (EDITOR_ARTIFACT_ATTRS.has(attr.name) || attr.name.startsWith('data-dev-') || attr.name.startsWith('data-lexical-')) continue;
    if (attr.name === 'style') {
      const jsx = styleToJsx(attr.value);
      if (jsx) parts.push(`style=${jsx}`);
    } else if (attr.name === 'class') {
      parts.push(`className="${escapeAttrValue(attr.value)}"`);
    } else if (attr.name === 'for') {
      parts.push(`htmlFor="${escapeAttrValue(attr.value)}"`);
    } else {
      if (attr.name === 'href' && UNSAFE_URL_RE.test(attr.value)) continue;
      parts.push(`${attr.name}="${escapeAttrValue(attr.value)}"`);
    }
  }
  return parts;
}

function escapeJsxText(text: string): string {
  if (!/[<>{}&]/.test(text)) return text;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/{/g, '&#123;')
    .replace(/}/g, '&#125;');
}

const SEMANTIC_TAG: Record<string, string> = { b: 'strong', i: 'em' };

function semanticTag(tag: string): string {
  const lower = tag.toLowerCase();
  return SEMANTIC_TAG[lower] || lower;
}

function collapseRedundantNesting(el: Element): Element {
  const kids = Array.from(el.childNodes);
  if (
    kids.length === 1 &&
    kids[0] instanceof Element &&
    semanticTag(kids[0].tagName) === semanticTag(el.tagName) &&
    el.attributes.length === 0
  ) {
    return collapseRedundantNesting(kids[0]);
  }
  return el;
}

function nodeToJsx(node: Node, preserveSpans: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeJsxText(node.textContent || '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = collapseRedundantNesting(node as Element);
  const tag = el.tagName.toLowerCase();
  const attrs = attributesToJsx(el);
  const children = Array.from(el.childNodes).map(n => nodeToJsx(n, preserveSpans)).join('');

  if (tag === 'span' && attrs.length === 0 && !preserveSpans) return children;

  const outputTag = SEMANTIC_TAG[tag] || tag;
  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  if (!children) return `<${outputTag}${attrStr} />`;
  return `<${outputTag}${attrStr}>${children}</${outputTag}>`;
}
