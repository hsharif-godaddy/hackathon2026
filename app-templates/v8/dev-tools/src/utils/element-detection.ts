import { isCommerceManagedContent } from "./commerce-managed-content";

// ─── Tag sets (composed smallest → largest) ──────────────────────────────────

export const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export const INLINE_TEXT_TAGS = new Set(["span", "a", "label"]);

/** Block-level text: headings + semantic block elements. */
export const BLOCK_TEXT_TAGS = new Set([...HEADING_TAGS, "p", "li", "blockquote"]);

/** All text formatting targets — inline (INLINE_TEXT_TAGS) + block (BLOCK_TEXT_TAGS). */
export const TEXT_TAGS = new Set([...INLINE_TEXT_TAGS, ...BLOCK_TEXT_TAGS]);

/** List container elements. */
export const LIST_TAGS = new Set(["ul", "ol"]);

/** Embedded media elements. */
export const MEDIA_TAGS = new Set(["img", "video", "svg", "canvas", "picture"]);

/** Form control elements. */
export const FORM_TAGS = new Set(["input", "textarea", "select"]);

/**
 * All content elements — superset of TEXT_TAGS, LIST_TAGS, MEDIA_TAGS, and
 * FORM_TAGS. Used for hover-bar visibility and AI edit targeting.
 */
export const CONTENT_TAGS = new Set([...TEXT_TAGS, ...LIST_TAGS, ...MEDIA_TAGS, ...FORM_TAGS]);

// ─── Element classification helpers ──────────────────────────────────────────

/**
 * Returns true for elements that carry user-visible text and support inline
 * formatting actions (bold, italic, color, font size).
 * Includes both inline (span, a, label) and
 * block-level (p, h1–h6, li, blockquote) tags.
 */
export function isTextElement(element: HTMLElement): boolean {
  return TEXT_TAGS.has(element.tagName.toLowerCase());
}

/**
 * Returns true for block-level text elements that support block-level
 * formatting actions (e.g. text-align). Inline tags (span, a, label)
 * are excluded because block-level formatting has no effect on them.
 */
export function isTextBlockElement(element: HTMLElement): boolean {
  return BLOCK_TEXT_TAGS.has(element.tagName.toLowerCase());
}

/**
 * Returns true for list container elements (ul, ol).
 * Use alongside isTextElement to gate list-type formatting controls.
 */
export function isListElement(element: HTMLElement): boolean {
  return LIST_TAGS.has(element.tagName.toLowerCase());
}

/** Check if an element is interactive (clicks should pass through) */
export function isClickable(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "a" || tag === "button") return true;
  if (element.getAttribute("role") === "button") return true;
  if (element.onclick || element.hasAttribute("onclick")) return true;
  if (element.closest("a, button, [role='button']")) return true;
  return false;
}

/** True when the element is inside a navigation surface — a <nav>, or any
 *  ARIA navigation/menu/menubar. Used in Edit mode to let nav clicks pass
 *  through to the SPA router instead of opening the Hover Bar / inline editor.
 *
 *  Target-agnostic: a child span inside a nav anchor returns true too,
 *  which matches how mouseover/click events often land on inner elements.
 *
 *  The role selectors cover navigation surfaces that may live outside a
 *  <nav> element — e.g. agent-authored markup using `role='navigation'`
 *  instead of the semantic tag, Radix DropdownMenu (portalled,
 *  role='menu'), or Radix Menubar (role='menubar'). Menu items are
 *  aria-defined as action triggers, never editable text content, so this
 *  broadening is safe. */
export function isInsideNavSurface(element: HTMLElement): boolean {
  return !!element.closest("nav, [role='navigation'], [role='menu'], [role='menubar']");
}

/** True on pages where editing is restricted to the annotated managed fields
 *  (data-editable / data-section) rather than free-form inline editing —
 *  currently the compliance pages (/privacy, /terms), handled by
 *  useComplianceFieldEditor. On these pages the general inline editor must stand
 *  down so customers can't edit the surrounding prose. Mirrors the path check in
 *  useComplianceFieldEditor's inferDocumentType. */
export function isManagedPath(pathname: string = window.location.pathname): boolean {
  return pathname.startsWith("/privacy") || pathname.startsWith("/terms");
}

/** Selector for the compliance fields a generated managed doc contains. Keep in
 *  sync with useComplianceFieldEditor's FIELD_SELECTOR / SECTION_SELECTOR. */
const MANAGED_DOC_SELECTOR = '[data-editable="true"][data-field], [data-section][data-section-when]';

/** True when the document actually contains compliance markup — i.e. it is a
 *  generated managed doc, not a plain page that merely lives at /privacy or
 *  /terms. The data-editable / data-section attributes are present in the
 *  rendered HTML regardless of edit mode, so this is a reliable structural
 *  signal: a pre-existing privacy/terms page without the markup is NOT treated
 *  as managed and keeps full inline editing. */
export function hasManagedDocMarkup(root: ParentNode = document): boolean {
  return !!root.querySelector(MANAGED_DOC_SELECTOR);
}

/** Returns true for elements where block-level formatting (alignment, lists) makes sense for inline editing. */
export function isBodyTextElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === "p" || tag === "li" || LIST_TAGS.has(tag);
}

/** Check if an element is suitable for inline text editing */
export function isTextEditable(element: HTMLElement, cmsInlineEditEnabled: boolean): boolean {
  if (isCommerceManagedContent(element)) return false;

  // Content-layer elements are editable only when CMS inline-edit is enabled.
  // When the flag is off they are NOT editable AND must not fall through to the
  // AST heuristics below — editing a content-bound element via the JSX source
  // path hardcodes the value and breaks the binding for every mapped item.
  if (resolveContentKey(element) !== null) return cmsInlineEditEnabled;

  if (element.closest("[data-dev-dynamic]") || element.querySelector("[data-dev-dynamic]")) return false;

  const tagName = element.tagName.toLowerCase();
  const textContent = element.textContent?.trim() || "";

  const hasText = textContent.length > 0;
  const isListContainer = LIST_TAGS.has(tagName);
  const hasOnlyText = isListContainer
    ? Array.from(element.children).every((child) => child.tagName.toLowerCase() === "li")
    : element.children.length === 0 ||
      Array.from(element.children).every((child) => {
        const tag = child.tagName.toLowerCase();
        return tag === "br" || tag === "span" || tag === "strong" || tag === "em" || tag === "b" || tag === "i" || tag === "a";
      });

  // Authoritative shut-off: the text-tag (AST/static-literal) edit path requires
  // the source-mapper's per-node data-dev-editable="text" marker, computed from
  // the same AST the server inspects on save. This can only REMOVE editability —
  // it never makes more nodes editable — eliminating the open-then-400 divergence
  // where the DOM heuristic disagreed with the server's
  // hasUnsupportedDynamicTextExpression.
  //
  // List containers (ul/ol) are exempt: the source-mapper only marks intrinsic
  // text tags (getIntrinsicTextTagName excludes ul/ol), so requiring the marker
  // there would regress list editing rather than shut off a server-rejected node.
  const passesMarkerGate = isListContainer || element.getAttribute("data-dev-editable") === "text";

  return (TEXT_TAGS.has(tagName) || isListContainer) && hasText && hasOnlyText && passesMarkerGate;
}

/**
 * Resolve a concrete content key from an element's data-dev-content-key
 * attributes. Handles both direct keys and template keys combined with the
 * enclosing ContentListContext's data-dev-content-list + per-item index.
 *
 * Returns null when the element is not content-keyed.
 */
export function resolveContentKey(element: HTMLElement): { key: string; kind: "copy" | "richText" } | null {
  const direct = element.getAttribute("data-dev-content-key");
  const kindAttr = element.getAttribute("data-dev-content-kind");
  const kind: "copy" | "richText" = kindAttr === "richText" ? "richText" : "copy";
  if (direct) {
    return { key: direct, kind };
  }

  const template = element.getAttribute("data-dev-content-key-template");
  if (!template) return null;

  // Walk ancestors (starting at the element itself) collecting (field, index) pairs.
  // Supports both self-describing layout (field + index on same element) and
  // ContentListContext layout (field on wrapper, index on child). Each [] in the
  // template is resolved left→right by matching the prefix before that [] to a
  // collected pair's field.
  const pairs: Array<{ field: string; index: string; id: string | null }> = [];
  let pendingIndex: string | null = null;
  let pendingId: string | null = null;
  let cursor: HTMLElement | null = element;
  while (cursor) {
    const field = cursor.getAttribute("data-dev-content-list");
    const idx = cursor.getAttribute("data-dev-content-list-index");
    const itemId = cursor.getAttribute("data-dev-item-id");
    if (field !== null) {
      // Index = own idx if present, else the nearest pending index from below.
      const resolvedIndex = idx ?? pendingIndex;
      if (resolvedIndex !== null) {
        pairs.push({ field, index: resolvedIndex, id: itemId ?? pendingId });
        pendingIndex = null;
        pendingId = null;
      }
    } else {
      if (idx !== null && pendingIndex === null) {
        // No field on this element — stash the index for the next field above.
        pendingIndex = idx;
      }
      if (itemId !== null && pendingId === null) {
        // No field here — stash the item id for the next field above.
        pendingId = itemId;
      }
    }
    cursor = cursor.parentElement;
  }

  // Substitute each [] left→right. The prefix before the i-th [] is the
  // template-form list path (e.g. "menu.categories[].items"); match it to a
  // collected pair's field and splice in that pair's id-anchored ref (@id) when
  // present, else its positional index.
  const segments = template.split("[]");
  let result = segments[0];
  for (let i = 1; i < segments.length; i++) {
    const prefix = segments.slice(0, i).join("[]");
    const pair = pairs.find((p) => p.field === prefix);
    if (!pair) return null;
    const ref = pair.id !== null ? `@${pair.id}` : pair.index;
    result += `[${ref}]${segments[i]}`;
  }

  return { key: result, kind };
}

/** Check if an element is a leaf content element worth targeting for AI edit */
export function isContentElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();

  if (CONTENT_TAGS.has(tag)) return true;

  const rect = element.getBoundingClientRect();
  const isSmall = rect.width < 400 && rect.height < 300;
  const hasFewChildren = element.children.length <= 3;
  const hasDirectText = Array.from(element.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim().length || 0) > 0,
  );

  return isSmall || (hasFewChildren && hasDirectText);
}

/** Check whether dev-tools should ignore this element. Covers dev-tools chrome
 *  itself plus any runtime UI that opts out via `data-airo-non-editable` (e.g.
 *  the cookie consent banner, which is consent-state UI, not authored content). */
export function isDevToolsElement(element: HTMLElement): boolean {
  return (
    !!element.closest("#dev-mode-overlay") ||
    !!element.closest("[data-dev-tools]") ||
    !!element.closest("[data-airo-dev-tools]") ||
    !!element.closest("[data-airo-non-editable]") ||
    !!element.closest(".edit-mode-hover-bar") ||
    !!element.closest(".edit-mode-link-follow-bar") ||
    !!element.closest("[id^='ai-select-overlay']")
  );
}

/** Generate a basic CSS selector for an element */
export function generateSelector(element: HTMLElement): string {
  if (element.id) return `#${element.id}`;

  let selector = element.tagName.toLowerCase();
  if (element.className && typeof element.className === "string") {
    const classes = element.className
      .split(" ")
      .filter((c) => c.trim() && !c.includes(":"))
      .map((c) => c.replace(/[^\w-]/g, ""))
      .filter((c) => c.length > 0);
    if (classes.length > 0) {
      selector += "." + classes.join(".");
    }
  }
  return selector;
}

/** Check if an element is an image or contains/wraps an image */
export function detectImage(element: HTMLElement): {
  isImage: boolean;
  imageUrl: string | null;
  imageElement: HTMLElement | null;
  type: "img" | "video" | "background" | null;
  isVideo: boolean;
} {
  const none = { isImage: false, imageUrl: null, imageElement: null, type: null, isVideo: false } as const;

  if (element.tagName.toLowerCase() === "img") {
    const img = element as HTMLImageElement;
    return {
      isImage: true,
      imageUrl: img.src || img.currentSrc || null,
      imageElement: element,
      type: "img",
      isVideo: false,
    };
  }

  if (element.tagName.toLowerCase() === "video") {
    const video = element as HTMLVideoElement;
    const sourceEl = video.querySelector("source") as HTMLSourceElement | null;
    const videoUrl = video.src || sourceEl?.src || video.currentSrc || null;
    return {
      isImage: true,
      imageUrl: videoUrl,
      imageElement: element,
      type: "video",
      isVideo: true,
    };
  }

  const bg = window.getComputedStyle(element).backgroundImage;
  if (bg && bg !== "none") {
    const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
    if (match?.[1])
      return { isImage: true, imageUrl: match[1], imageElement: element, type: "background" };
  }

  const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
  const candidates = [
    ...Array.from(element.children),
    ...siblings,
  ];
  for (const candidate of candidates) {
    if (candidate === element) continue;
    if (candidate.tagName.toLowerCase() === "video") {
      const video = candidate as HTMLVideoElement;
      const sourceEl = video.querySelector("source") as HTMLSourceElement | null;
      const videoUrl = video.src || sourceEl?.src || video.currentSrc || null;
      return {
        isImage: true,
        imageUrl: videoUrl,
        imageElement: candidate as HTMLElement,
        type: "video",
        isVideo: true,
      };
    }
    if (candidate.tagName.toLowerCase() === "img") {
      const img = candidate as HTMLImageElement;
      return {
        isImage: true,
        imageUrl: img.src || img.currentSrc || null,
        imageElement: candidate as HTMLElement,
        type: "img",
        isVideo: false,
      };
    }
  }

  for (const sibling of siblings) {
    if (sibling === element) continue;
    const nestedVideo = sibling.querySelector("video") as HTMLVideoElement | null;
    if (nestedVideo) {
      const sourceEl = nestedVideo.querySelector("source") as HTMLSourceElement | null;
      const videoUrl = nestedVideo.src || sourceEl?.src || nestedVideo.currentSrc || null;
      return {
        isImage: true,
        imageUrl: videoUrl,
        imageElement: nestedVideo,
        type: "video",
        isVideo: true,
      };
    }
    const nestedImg = sibling.querySelector("img") as HTMLImageElement | null;
    if (nestedImg) {
      return {
        isImage: true,
        imageUrl: nestedImg.src || nestedImg.currentSrc || null,
        imageElement: nestedImg,
        type: "img",
        isVideo: false,
      };
    }
  }

  return none;
}

/** Check if a URL is a media slot and extract the slot path */
export function getMediaSlotPath(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/airo-assets\/(?:images|videos)\/(.+?)(?:\?|$)/);
  return match ? match[1] : null;
}
