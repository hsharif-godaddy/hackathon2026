import { isDevToolsElement, isTextEditable, resolveContentKey } from "./element-detection";
import { t } from "./translations";
import { rgbToHex } from "./color";

export const INDICATOR_MS = 1500;

export const INLINE_TAGS = new Set(["em", "strong", "b", "i", "span", "br", "a"]);

// CSS properties to copy from target element to editor overlay
const COPY_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "color",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textAlign",
  "textTransform",
  "textDecoration",
  "textIndent",
  "whiteSpace",
  "direction",
  "backgroundColor",
  "padding",
] as const;

// ── Element finding ──

export function findEditableContainer(el: HTMLElement, cmsInlineEditEnabled: boolean): HTMLElement | null {
  let current: HTMLElement | null = el;
  let best: HTMLElement | null = null;
  let outermostInline: HTMLElement | null = null;
  while (current) {
    // Hard-stop: when the flag is off, a content-keyed element must not be walked
    // past. Returning null here — at the top of each iteration, before any
    // editable-container or outermostInline fallback below can return — prevents
    // the walk from landing on a non-content ancestor and opening the JSX editor
    // on it, which would hardcode the value and corrupt the CMS binding.
    if (!cmsInlineEditEnabled && resolveContentKey(current) !== null) return null;

    const isInline = INLINE_TAGS.has(current.tagName.toLowerCase());
    if (isTextEditable(current, cmsInlineEditEnabled) && !current.querySelector("br")) {
      if (isInline) {
        best = current;
      } else {
        const result = best || current;
        return liftToParentList(result, cmsInlineEditEnabled);
      }
    }
    if (isInline) {
      outermostInline = current;
    } else {
      if (best) return best;
      // Fallback: the outermost inline element (e.g. motion.i used as a heading)
      // may not be in textTags but still looks like a text container.
      if (outermostInline && outermostInline.textContent?.trim() && !outermostInline.querySelector("br") && hasOnlyInlineChildren(outermostInline)) {
        return outermostInline;
      }
      return null;
    }
    current = current.parentElement;
  }
  return best;
}

function hasOnlyInlineChildren(el: HTMLElement): boolean {
  return el.children.length === 0 ||
    Array.from(el.children).every((child) => {
      const tag = child.tagName.toLowerCase();
      return INLINE_TAGS.has(tag);
    });
}

function liftToParentList(el: HTMLElement, cmsInlineEditEnabled: boolean): HTMLElement {
  if (el.tagName.toLowerCase() !== "li") return el;
  const parent = el.parentElement;
  if (!parent) return el;
  const parentTag = parent.tagName.toLowerCase();
  if ((parentTag === "ul" || parentTag === "ol") && isTextEditable(parent, cmsInlineEditEnabled)) {
    return parent;
  }
  return el;
}

export function findBrSegment(
  el: HTMLElement,
  x: number,
  y: number,
  cmsInlineEditEnabled: boolean,
): { segment: HTMLElement; parent: HTMLElement } | null {
  let brParent: HTMLElement | null = el;
  while (brParent) {
    // Hard-stop: same as findEditableContainer — don't walk past a content-keyed
    // element when the flag is off.
    if (!cmsInlineEditEnabled && resolveContentKey(brParent) !== null) return null;

    const isInline = INLINE_TAGS.has(brParent.tagName.toLowerCase());
    if (!isInline && isTextEditable(brParent, cmsInlineEditEnabled) && brParent.querySelector("br")) break;
    if (!isInline) return null;
    brParent = brParent.parentElement;
  }
  if (!brParent) return null;

  if (el === brParent) {
    const wrapped = wrapBareTextNode(brParent, x, y);
    return wrapped ? { segment: wrapped, parent: brParent } : null;
  }

  let directChild: HTMLElement | null = el;
  while (directChild && directChild.parentElement !== brParent) {
    directChild = directChild.parentElement;
  }

  if (
    !directChild ||
    directChild.tagName.toLowerCase() === "br" ||
    !directChild.textContent?.trim()
  ) {
    return null;
  }

  const segment = wrapSegmentIfNeeded(directChild, brParent);
  return { segment, parent: brParent };
}

function wrapSegmentIfNeeded(
  child: HTMLElement,
  parent: HTMLElement,
): HTMLElement {
  const children = Array.from(parent.childNodes);
  const idx = children.indexOf(child);

  let start = idx;
  while (start > 0) {
    const prev = children[start - 1];
    if (prev instanceof HTMLElement && prev.tagName.toLowerCase() === "br") break;
    start--;
  }

  let end = idx;
  while (end < children.length - 1) {
    const next = children[end + 1];
    if (next instanceof HTMLElement && next.tagName.toLowerCase() === "br") break;
    end++;
  }

  const siblings = children.slice(start, end + 1);
  if (siblings.length <= 1) return child;

  const span = document.createElement("span");
  span.setAttribute("data-airo-segment", "true");
  parent.insertBefore(span, siblings[0]);
  for (const node of siblings) span.appendChild(node);
  return span;
}

// ── DOM manipulation ──

export function safeSetInnerHtml(element: HTMLElement, html: string) {
  const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  const container = doc.body.querySelector("div")!;
  while (element.firstChild) element.removeChild(element.firstChild);
  while (container.firstChild) element.appendChild(element.ownerDocument.adoptNode(container.firstChild));
}

function unwrapBySelector(root: HTMLElement, selector: string) {
  for (const span of root.querySelectorAll(selector)) {
    const parent = span.parentNode!;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    span.remove();
  }
}

export function unwrapAiroSpans(root: HTMLElement) {
  unwrapBySelector(root, "[data-airo-wrapped]");
}

export function unwrapAiroSegments(root: HTMLElement) {
  unwrapBySelector(root, "[data-airo-segment]");
}

export function unwrapOrReveal(element: HTMLElement) {
  if ((element.hasAttribute("data-airo-wrapped") || element.hasAttribute("data-airo-segment")) && element.parentNode) {
    const parent = element.parentNode;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    element.remove();
    (parent as HTMLElement).style.visibility = "";
  } else {
    element.style.visibility = "";
  }
}

function caretRangeAt(x: number, y: number): Range | null {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const pos = (document as any).caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  return range;
}

function wrapTextNode(parent: HTMLElement, node: Text): HTMLElement {
  const span: HTMLElement = document.createElement("span");
  span.setAttribute("data-airo-wrapped", "true");
  parent.insertBefore(span, node);
  span.appendChild(node);
  return span;
}

function bareChildTextNodes(parent: HTMLElement): Text[] {
  const result: Text[] = [];
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      result.push(node as Text);
    }
  }
  return result;
}

// Self-healing fallback: when the caret resolves to a glyph (precise click) we
// wrap that exact bare text node. But on large/centered display headings the
// click frequently resolves to the element itself or to null, leaving the
// heading uneditable. Rather than refuse the cursor, fall back to a sensible
// direct-child bare text node so the user always gets a caret. With real
// layout we prefer the line nearest the click `y`; in jsdom (no layout, all
// rects zero) this cleanly degrades to the first non-empty bare text node.
function pickFallbackTextNode(candidates: Text[], y: number): Text {
  let best: Text = candidates[0];
  let bestDistance: number = Infinity;
  for (const node of candidates) {
    let rect: DOMRect;
    try {
      const range: Range = document.createRange();
      range.selectNodeContents(node);
      rect = range.getBoundingClientRect();
    } catch {
      continue;
    }
    if (rect.height === 0 && rect.width === 0) continue;
    const center: number = rect.top + rect.height / 2;
    const distance: number = Math.abs(center - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

function wrapBareTextNode(
  parent: HTMLElement,
  x: number,
  y: number,
): HTMLElement | null {
  unwrapAiroSpans(parent);

  const range: Range | null = caretRangeAt(x, y);
  const node: Node | null = range ? range.startContainer : null;
  if (
    node &&
    node.nodeType === Node.TEXT_NODE &&
    node.textContent?.trim() &&
    node.parentElement === parent
  ) {
    return wrapTextNode(parent, node as Text);
  }

  const candidates: Text[] = bareChildTextNodes(parent);
  if (candidates.length === 0) return null;
  return wrapTextNode(parent, pickFallbackTextNode(candidates, y));
}

export function wrapBareChildTextNodes(parent: HTMLElement) {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const span = parent.ownerDocument.createElement("span");
      parent.insertBefore(span, node);
      span.appendChild(node);
    }
  }
}

// ── Formatting signature ──

const SIGNATURE_SEMANTIC: Record<string, string> = { b: "strong", i: "em", strong: "strong" };

/**
 * Produce a structural "signature" of the formatting tags in an HTML fragment.
 * Used to detect whether the user changed formatting (bold/italic) vs Lexical
 * just re-serializing the same content with its own wrappers.
 *
 * Resilient to two Lexical quirks:
 * 1. Lexical double-wraps italic as <i><em>X</em></i> — after normalizing
 *    i→em, the redundant <em><em> nesting is collapsed.
 * 2. Lexical wraps bare text in <span> (no attributes) — these are ignored.
 */
export function formattingSignature(html: string): string {
  const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  const root = doc.body.querySelector("div")!;

  function walk(el: Element, parentTag: string | null): string {
    let sig = "";
    for (const child of el.childNodes) {
      if (!(child instanceof Element)) continue;
      const rawTag = child.tagName.toLowerCase();
      const tag = SIGNATURE_SEMANTIC[rawTag] || rawTag;

      // Ignore <span> with no visual attributes (Lexical wraps text in
      // <span data-lexical-text="true"> which isn't a formatting change)
      if (tag === "span" && !child.hasAttribute("style") && !child.hasAttribute("class")) {
        sig += walk(child, parentTag);
        continue;
      }

      // Collapse redundant nesting: <em><em>X</em></em> → <em>X</em>
      if (tag === parentTag) {
        sig += walk(child, parentTag);
        continue;
      }

      sig += `<${tag}>` + walk(child, tag) + `</${tag}>`;
    }
    return sig;
  }

  return walk(root, null);
}

// ── HTML normalization ──

const SEMANTIC_TAGS: Record<string, string> = { B: "STRONG", I: "EM" };

function normalizeSemanticTags(root: Element) {
  for (const [from, to] of Object.entries(SEMANTIC_TAGS)) {
    for (const el of Array.from(root.querySelectorAll(from))) {
      const replacement = root.ownerDocument.createElement(to);
      for (const attr of Array.from(el.attributes))
        replacement.setAttribute(attr.name, attr.value);
      while (el.firstChild) replacement.appendChild(el.firstChild);
      el.parentNode!.replaceChild(replacement, el);
    }
  }
}

const SEMANTIC_COLLAPSE: Record<string, string> = { B: "STRONG", I: "EM" };

function collapseRedundantNesting(node: Element) {
  for (const child of Array.from(node.children)) collapseRedundantNesting(child);
  const kids = Array.from(node.childNodes);
  if (
    kids.length === 1 &&
    kids[0] instanceof Element &&
    (SEMANTIC_COLLAPSE[kids[0].tagName] || kids[0].tagName) ===
      (SEMANTIC_COLLAPSE[node.tagName] || node.tagName) &&
    node.attributes.length === 0
  ) {
    const inner = kids[0];
    while (inner.firstChild) node.insertBefore(inner.firstChild, inner);
    node.removeChild(inner);
  }
}

const FORMAT_ORDER: Record<string, number> = { strong: 0, b: 0, em: 1, i: 1 };

function canonicalizeFormattingOrder(node: Element) {
  for (const child of Array.from(node.children)) canonicalizeFormattingOrder(child);
  const kids = Array.from(node.childNodes);
  if (kids.length !== 1 || !(kids[0] instanceof Element)) return;
  const child = kids[0] as Element;
  const outerTag = node.tagName.toLowerCase();
  const innerTag = child.tagName.toLowerCase();
  if (!(outerTag in FORMAT_ORDER) || !(innerTag in FORMAT_ORDER)) return;
  if (FORMAT_ORDER[outerTag] <= FORMAT_ORDER[innerTag]) return;
  if (node.attributes.length > 0 || child.attributes.length > 0) return;
  // <em><strong>X</strong></em> → <strong><em>X</em></strong>
  const doc = node.ownerDocument;
  const newOuter = doc.createElement(innerTag);
  const newInner = doc.createElement(outerTag);
  while (child.firstChild) newInner.appendChild(child.firstChild);
  newOuter.appendChild(newInner);
  node.parentNode!.replaceChild(newOuter, node);
}

function shellMatch(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName) return false;
  if (a.attributes.length !== b.attributes.length) return false;
  return Array.from(a.attributes).every(attr =>
    b.getAttribute(attr.name) === attr.value
  );
}

function mergeAdjacentSiblings(node: Element) {
  for (const child of Array.from(node.children)) mergeAdjacentSiblings(child);
  let i = 0;
  const kids = node.childNodes;
  while (i < kids.length - 1) {
    const curr = kids[i];
    const next = kids[i + 1];
    if (
      curr instanceof Element &&
      next instanceof Element &&
      shellMatch(curr, next)
    ) {
      while (next.firstChild) curr.appendChild(next.firstChild);
      next.remove();
      mergeAdjacentSiblings(curr);
    } else {
      i++;
    }
  }
}

export function normalizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(
    "<div>" + html + "</div>",
    "text/html",
  );
  const root = doc.body.querySelector("div")!;
  for (const el of root.querySelectorAll("[data-dev-file]")) {
    el.removeAttribute("data-dev-file");
    el.removeAttribute("data-dev-line");
  }
  for (const el of root.querySelectorAll("[style], [class]")) {
    if (el.getAttribute("style")?.trim() === "") el.removeAttribute("style");
    if (el.getAttribute("class")?.trim() === "") el.removeAttribute("class");
  }
  normalizeSemanticTags(root);
  collapseRedundantNesting(root);
  canonicalizeFormattingOrder(root);
  mergeAdjacentSiblings(root);
  return root.innerHTML;
}

// ── Style computation ──

function isTransparent(color: string): boolean {
  return !color || color === "transparent" || color === "rgba(0, 0, 0, 0)";
}

function parseRgb(color: string): [number, number, number] | null {
  const m = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
  );
  if (m) return [+m[1], +m[2], +m[3]];
  if (color.startsWith("#")) {
    const hex = color.length === 4
      ? color[1] + color[1] + color[2] + color[2] + color[3] + color[3]
      : color.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

// Relative luminance per WCAG 2.0
function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function hasLowContrast(color1: string, color2: string): boolean {
  const rgb1 = parseRgb(color1);
  const rgb2 = parseRgb(color2);
  if (!rgb1 || !rgb2) return false;
  const l1 = luminance(...rgb1);
  const l2 = luminance(...rgb2);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return ratio < 2.5;
}

function getEffectiveBackground(element: HTMLElement): string {
  let el: HTMLElement | null = element;
  while (el) {
    const bg = window.getComputedStyle(el).backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
    el = el.parentElement;
  }
  return "#ffffff";
}

function getEffectiveColor(element: HTMLElement): string {
  const computed = window.getComputedStyle(element);
  if (!isTransparent(computed.color)) return computed.color;

  const stroke = computed.getPropertyValue("-webkit-text-stroke-color");
  if (stroke && !isTransparent(stroke)) return stroke;

  let el = element.parentElement;
  while (el) {
    const c = window.getComputedStyle(el).color;
    if (!isTransparent(c)) return c;
    el = el.parentElement;
  }
  return "#000000";
}

export function isSingleLine(element: HTMLElement): boolean {
  const rects = element.getClientRects();
  if (rects.length > 1) return false;
  const computed = window.getComputedStyle(element);
  let lineHeight = parseFloat(computed.lineHeight);
  if (!lineHeight || isNaN(lineHeight)) {
    lineHeight = parseFloat(computed.fontSize) * 1.2;
  }
  if (!lineHeight || isNaN(lineHeight)) return false;
  const height = rects.length === 1 ? rects[0].height : element.scrollHeight;
  return height <= lineHeight * 1.5;
}

export function getComputedStyleMap(element: HTMLElement): Record<string, string> {
  const computed = window.getComputedStyle(element);
  const styles: Record<string, string> = {};
  for (const prop of COPY_STYLES) {
    styles[prop] = computed[prop];
  }
  const bg = getEffectiveBackground(element);
  const fg = getEffectiveColor(element);
  styles.backgroundColor = bg;
  styles.color = fg;
  if (hasLowContrast(fg, bg)) {
    const fgRgb = parseRgb(fg);
    const isLightText = fgRgb ? luminance(...fgRgb) > 0.5 : false;
    styles.backgroundColor = isLightText ? "#1a1a1a" : "#ffffff";
  }
  return styles;
}

// ── Overlay ──

export function createFixedOverlay(source: HTMLElement): HTMLElement | null {
  const overlay = source.cloneNode(false) as HTMLElement;
  if (!positionOverlay(overlay, source)) return null;
  document.body.appendChild(overlay);
  return overlay;
}

function positionOverlay(overlay: HTMLElement, target: HTMLElement): boolean {
  // A detached target returns an all-zero rect, which would park the overlay
  // at the page origin. Bail out instead so the caller can skip overlaying.
  if (!target.isConnected) return false;
  const rect = target.getBoundingClientRect();
  overlay.style.position = "absolute";
  overlay.style.top = (rect.top + window.scrollY) + "px";
  overlay.style.left = (rect.left + window.scrollX) + "px";
  overlay.style.width = rect.width + "px";
  overlay.style.minHeight = rect.height + "px";
  overlay.style.zIndex = "99998";
  overlay.style.pointerEvents = "none";
  overlay.style.visibility = "";
  overlay.style.textAlign = window.getComputedStyle(target).textAlign;
  overlay.setAttribute("data-dev-tools", "true");
  overlay.setAttribute("data-airo-overlay", "true");
  return true;
}

/**
 * Merge style declarations and class names from `source` onto `target`,
 * preserving properties already set on `target` (e.g. the positioning styles
 * applied by createFixedOverlay).
 */
export function mergeRootAttrsOntoOverlay(target: HTMLElement, source: HTMLElement): void {
  const sourceStyle = source.getAttribute("style");
  if (sourceStyle) {
    const probe = document.createElement("div");
    probe.setAttribute("style", sourceStyle);
    for (let i = 0; i < probe.style.length; i++) {
      const prop = probe.style[i];
      target.style.setProperty(prop, probe.style.getPropertyValue(prop));
    }
  }
  const sourceClass = source.getAttribute("class");
  if (sourceClass) {
    const existing = target.getAttribute("class") || "";
    const merged = [existing, sourceClass].filter(Boolean).join(" ");
    target.setAttribute("class", merged);
  }
}

/**
 * Retire the optimistic overlay the moment the real `source` element reflects
 * the saved value. The content edit triggers an HMR re-render that updates the
 * source element to `expectedText`; that re-render usually lands well before
 * the save-success ACK. If the overlay (a positioned clone showing the same
 * text) lingers until the ACK, it and the re-rendered element both paint —
 * slightly offset — producing a ghost/double. This calls `onReflected` as soon
 * as the source matches so the caller can drop the overlay immediately.
 *
 * Fires synchronously if the source already matches; otherwise watches for the
 * re-render via a MutationObserver. Returns an idempotent disconnect function.
 */
export function watchTextReflected(
  source: HTMLElement,
  expectedText: string,
  onReflected: () => void,
): () => void {
  const expected = expectedText.trim();
  const matches = (): boolean => (source.textContent ?? "").trim() === expected;
  if (matches()) {
    onReflected();
    return () => {};
  }
  const observer = new MutationObserver(() => {
    if (matches()) {
      observer.disconnect();
      onReflected();
    }
  });
  observer.observe(source, { childList: true, characterData: true, subtree: true });
  return () => observer.disconnect();
}

// ── Theme color extraction ──

const THEME_TEXT_SELECTOR = "p, h1, h2, h3, h4, h5, h6, span, a, li, button, label";
const THEME_BG_SELECTOR = "header, footer, nav, section, main, article, div, button, a";
const RGB_RE = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/;
// Sensible neutral defaults so the row always has 6 swatches even when
// the page palette is sparse.
const FALLBACK_PALETTE = ["#000000", "#ffffff", "#6b7280", "#3b82f6", "#10b981", "#ef4444"];

function parseRgbToHex(computed: string): string | null {
  const m = RGB_RE.exec(computed);
  if (!m) return null;
  const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
  if (alpha === 0) return null;
  return rgbToHex(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
}

/**
 * Walk visible elements in the document and return the most-used colors as
 * hex strings. Pulls from text `color` AND `background-color` so the swatch
 * row reflects the broader page palette (brand backgrounds, accent fills,
 * etc.), not just text colors. Pads with fallback neutrals so the row always
 * has `maxColors` entries.
 */
export function extractThemeColors(maxColors = 6): string[] {
  const counts = new Map<string, number>();
  const bump = (hex: string | null, weight: number) => {
    if (!hex) return;
    counts.set(hex, (counts.get(hex) || 0) + weight);
  };

  // Text colors (weighted by occurrence in text-bearing elements).
  for (const el of document.querySelectorAll(THEME_TEXT_SELECTOR)) {
    const htmlEl = el as HTMLElement;
    if (isDevToolsElement(htmlEl)) continue;
    if (!htmlEl.textContent?.trim()) continue;
    bump(parseRgbToHex(getComputedStyle(htmlEl).color), 2);
  }

  // Background colors (slightly lower weight; many backgrounds are transparent
  // and skipped, but solid fills like brand panels surface here).
  for (const el of document.querySelectorAll(THEME_BG_SELECTOR)) {
    const htmlEl = el as HTMLElement;
    if (isDevToolsElement(htmlEl)) continue;
    bump(parseRgbToHex(getComputedStyle(htmlEl).backgroundColor), 1);
  }

  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex);

  // Pad with fallbacks (deduped) up to maxColors.
  const seen = new Set(ranked);
  for (const fallback of FALLBACK_PALETTE) {
    if (ranked.length >= maxColors) break;
    if (seen.has(fallback)) continue;
    ranked.push(fallback);
    seen.add(fallback);
  }
  return ranked.slice(0, maxColors);
}

// ── Class merging ──

const LIST_ONLY_CLASSES = new Set(["list-disc", "list-decimal", "pl-6"]);

export function mergeOriginalClasses(newHtml: string, originalClasses: string): string {
  if (!originalClasses) return newHtml;
  const doc = new DOMParser().parseFromString(newHtml, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return newHtml;
  const rootTag = root.tagName.toLowerCase();
  const isListOutput = rootTag === "ul" || rootTag === "ol";
  const existing = new Set((root.getAttribute("class") || "").split(/\s+/).filter(Boolean));
  for (const cls of originalClasses.split(/\s+/).filter(Boolean)) {
    if (!isListOutput && LIST_ONLY_CLASSES.has(cls)) continue;
    if (!existing.has(cls)) {
      existing.add(cls);
      root.classList.add(cls);
    }
  }
  return root.outerHTML;
}

// ── UI ──

export function showIndicator(element: HTMLElement, type: "success" | "error" | "saving", message?: string) {
  injectEditorCss();
  const existing = document.getElementById("edit-mode-save-indicator");
  if (existing) existing.remove();

  const rect = element.getBoundingClientRect();
  const indicator = document.createElement("div");
  indicator.id = "edit-mode-save-indicator";

  let color: string;
  let bg: string;
  let border: string;
  if (type === "error") {
    color = "#dc2626";
    bg = "#fef2f2";
    border = "#fecaca";
    indicator.textContent = message || t("devtools_edit_failed", "Edit failed");
  } else if (type === "saving") {
    color = "#6b7280";
    bg = "#f9fafb";
    border = "#e5e7eb";
    const spinner = document.createElement("span");
    spinner.className = "airo-edit-spinner";
    indicator.appendChild(spinner);
    indicator.appendChild(document.createTextNode(t("devtools_saving", "Saving…")));
  } else {
    color = "var(--color-success)";
    bg = "var(--color-success-bg)";
    border = "var(--color-success-border)";
    indicator.textContent = t("devtools_saved", "Saved");
  }

  indicator.style.cssText = `
    position: fixed;
    top: ${rect.top - 24}px;
    right: ${window.innerWidth - rect.right}px;
    font-size: 11px;
    font-weight: 500;
    color: ${color};
    background: ${bg};
    border: 1px solid ${border};
    padding: 2px 8px;
    border-radius: 4px;
    z-index: 10001;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease-in;
    font-family: system-ui, sans-serif;
  `;
  document.body.appendChild(indicator);

  requestAnimationFrame(() => {
    indicator.style.opacity = "1";
  });

  // "saving" persists until a terminal state (success/error) replaces it; only
  // the terminal indicators auto-dismiss.
  if (type !== "saving") {
    setTimeout(() => {
      indicator.style.opacity = "0";
      setTimeout(() => indicator.remove(), 200);
    }, INDICATOR_MS);
  }
}

let cssInjected = false;
export function injectEditorCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent = ".airo-rte-p { margin: 0; text-align: inherit; } .airo-rte-single-line { white-space: nowrap; overflow: hidden; } .airo-rte-italic { font-style: italic; } .airo-rte-ul { list-style: disc; padding-left: 1.5em; margin: 0; } .airo-rte-ol { list-style: decimal; padding-left: 1.5em; margin: 0; } .airo-rte-li { margin: 0; } @keyframes airo-edit-spin { to { transform: rotate(360deg); } } .airo-edit-spinner { display: inline-block; width: 9px; height: 9px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: airo-edit-spin 0.6s linear infinite; margin-right: 5px; vertical-align: -1px; }";
  document.head.appendChild(style);
}

const loadedBoldFonts = new Set<string>();
const SYSTEM_FONTS = new Set([
  "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "system-ui",
  "Helvetica Neue", "Arial", "sans-serif", "serif", "monospace",
  "Georgia", "Times New Roman", "Courier New",
]);

/**
 * Ensure both regular (400) and bold (700) weights are available for the
 * element's font. Pages often ship only the weight they use, so toggling
 * font-bold can be a no-op visually if the OTHER weight isn't loaded
 * (the browser falls back to the closest available weight).
 */
export function ensureBoldFontLoaded(element: HTMLElement) {
  const fontFamily = window.getComputedStyle(element).fontFamily;
  const primaryFont = fontFamily.split(",")[0].replace(/['"]/g, "").trim();
  if (!primaryFont || loadedBoldFonts.has(primaryFont)) return;
  // System fonts need no loading; cache to skip on future hovers.
  if (SYSTEM_FONTS.has(primaryFont)) {
    loadedBoldFonts.add(primaryFont);
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${primaryFont.replace(/\s+/g, "+")}:wght@400;700&display=swap`;
  link.onload = () => {
    // Mark as loaded only on success so transient failures (offline, CSP, 404)
    // don't poison the cache for the whole session.
    loadedBoldFonts.add(primaryFont);
    Promise.all([
      document.fonts.load(`400 1em "${primaryFont}"`),
      document.fonts.load(`700 1em "${primaryFont}"`),
    ]).catch((err) => {
      console.warn('[ensureBoldFontLoaded] font load failed', primaryFont, err);
    });
  };
  link.onerror = () => {
    console.warn('[ensureBoldFontLoaded] stylesheet failed to load', primaryFont);
  };
  document.head.appendChild(link);
}
